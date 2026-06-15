import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { buildServer } from "../api/server.js";
import { parseConfig } from "../config/index.js";
import { encryptToken } from "../auth/crypto.js";
import { linkOauthAccountForUser, type OauthAccount } from "../db/index.js";
import { createArtifactStore } from "../storage/index.js";
import { createEmbedder, createQueryEmbedder } from "../embeddings/index.js";
import { createGenerator } from "../llm/index.js";
import { createExtractor } from "../extract/index.js";
import { createTranscriber } from "../asr/index.js";
import { createIngestQueue } from "../queue/index.js";
import { devConfig, testDb, truncateAll } from "./helpers.js";

const config = parseConfig({
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  VECTOR_DIM: String(devConfig.VECTOR_DIM),
  EMBEDDING_PROVIDER: "dev",
  LLM_PROVIDER: "dev",
  JWT_SECRET: "test-secret",
  // Needed for /auth/{google,microsoft}/url to build a consent URL.
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  MICROSOFT_CLIENT_ID: "test-ms-client-id",
  MICROSOFT_CLIENT_SECRET: "test-ms-client-secret",
});

const db = testDb();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const app = buildServer({
  db,
  store: createArtifactStore(config),
  redis,
  config,
  queryEmbedder: createQueryEmbedder(config),
  embedder: createEmbedder(config),
  generator: createGenerator(config),
  extractor: createExtractor(config, createGenerator(config)),
  transcriber: createTranscriber(config),
  ingestQueue: createIngestQueue(redis),
  consolidateOptions: {},
  relationshipStaleDays: 30,
});

beforeEach(() => truncateAll(db));
afterAll(async () => {
  await app.close();
  redis.disconnect();
  await db.destroy();
});

const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
const CAL = "https://www.googleapis.com/auth/calendar.readonly";

async function register(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "password123" },
  });
  return res.json() as { user: { id: string }; accessToken: string };
}

/** Seed a connected account directly (bypassing the live OAuth dance). */
function seedAccount(
  userId: string,
  over: Partial<Parameters<typeof linkOauthAccountForUser>[1]> = {},
): Promise<{ account?: OauthAccount }> {
  return linkOauthAccountForUser(db, {
    userId,
    provider: "google",
    providerAccountId: `sub-${Math.random().toString(36).slice(2)}`,
    accessToken: encryptToken("access", config.TOKEN_ENC_KEY),
    refreshToken: encryptToken("refresh", config.TOKEN_ENC_KEY),
    expiresAt: new Date(Date.now() + 3_600_000),
    scope: `openid email ${GMAIL} ${CAL}`,
    email: "work@example.com",
    displayName: "Work",
    ...over,
  });
}

const seedMicrosoftAccount = (userId: string) =>
  seedAccount(userId, {
    provider: "microsoft",
    scope: "openid email Mail.Read Calendars.Read",
    email: "work@outlook.com",
    displayName: "Outlook",
  });

describe("/accounts", () => {
  it("lists a user's accounts with granted services and never leaks tokens", async () => {
    const alice = await register("alice-acct@example.com");
    await seedAccount(alice.user.id);

    const res = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    const acct = list[0]!;
    expect(acct.email).toBe("work@example.com");
    expect((acct.services as { label: string }[]).map((s) => s.label)).toEqual([
      "Gmail",
      "Calendar",
      "Sign-in",
    ]);
    expect(acct.needsReauth).toBe(false);
    // Tokens must never be exposed.
    expect(acct.accessToken).toBeUndefined();
    expect(acct.access_token).toBeUndefined();
    expect(acct.refreshToken).toBeUndefined();
    expect(acct.refresh_token).toBeUndefined();
  });

  it("flags needsReauth when there is no refresh token and the access token expired", async () => {
    const alice = await register("alice-reauth@example.com");
    await seedAccount(alice.user.id, {
      refreshToken: null,
      expiresAt: new Date(Date.now() - 1000),
      scope: "openid email",
    });
    const res = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect((res.json() as { needsReauth: boolean }[])[0]!.needsReauth).toBe(true);
  });

  it("isolates accounts per user", async () => {
    const alice = await register("alice-iso@example.com");
    const bob = await register("bob-iso@example.com");
    await seedAccount(alice.user.id);

    const res = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(res.json()).toHaveLength(0);
  });

  it("disconnects an owned account and nulls the binding on its sources", async () => {
    const alice = await register("alice-del@example.com");
    const bob = await register("bob-del@example.com");
    const { account } = await seedAccount(alice.user.id);

    // Bind a gmail source to the account.
    const created = await app.inject({
      method: "POST",
      url: "/sources",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { kind: "gmail", displayName: "Work Mail", oauthAccountId: account!.id },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().oauth_account_id).toBe(account!.id);

    // Bob cannot delete Alice's account.
    const bobTry = await app.inject({
      method: "DELETE",
      url: `/accounts/${account!.id}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(bobTry.statusCode).toBe(404);

    // Alice disconnects it.
    const del = await app.inject({
      method: "DELETE",
      url: `/accounts/${account!.id}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(del.statusCode).toBe(204);

    // The source survives, with its binding nulled (ON DELETE SET NULL).
    const sources = await app.inject({
      method: "GET",
      url: "/sources",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const rows = sources.json() as { oauth_account_id: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.oauth_account_id).toBeNull();
  });
});

describe("POST /sources account binding validation", () => {
  it("rejects an account that isn't the caller's", async () => {
    const alice = await register("alice-bind@example.com");
    const bob = await register("bob-bind@example.com");
    const { account } = await seedAccount(bob.user.id);

    const res = await app.inject({
      method: "POST",
      url: "/sources",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { kind: "gmail", displayName: "X", oauthAccountId: account!.id },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an account id on a non-OAuth (filesystem) kind", async () => {
    const alice = await register("alice-fs@example.com");
    const { account } = await seedAccount(alice.user.id);
    const res = await app.inject({
      method: "POST",
      url: "/sources",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { kind: "filesystem", displayName: "X", config: { dir: "/tmp" }, oauthAccountId: account!.id },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("/auth/google/url link intent", () => {
  it("requires a Bearer token to link", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/url?mode=web&intent=link" });
    expect(res.statusCode).toBe(401);
  });

  it("returns a consent URL when authenticated", async () => {
    const alice = await register("alice-link@example.com");
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/url?mode=web&intent=link",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain("accounts.google.com");
  });
});

describe("Microsoft accounts + sources", () => {
  it("lists a Microsoft account with its Outlook services", async () => {
    const alice = await register("alice-ms@example.com");
    await seedMicrosoftAccount(alice.user.id);
    const res = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const acct = (res.json() as Record<string, unknown>[])[0]!;
    expect(acct.provider).toBe("microsoft");
    expect((acct.services as { label: string }[]).map((s) => s.label)).toEqual([
      "Outlook Mail",
      "Calendar",
      "Sign-in",
    ]);
  });

  it("binds an msmail source to a Microsoft account but rejects a Google one", async () => {
    const alice = await register("alice-msbind@example.com");
    const { account: google } = await seedAccount(alice.user.id);
    const { account: ms } = await seedMicrosoftAccount(alice.user.id);

    const wrong = await app.inject({
      method: "POST",
      url: "/sources",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { kind: "msmail", displayName: "X", oauthAccountId: google!.id },
    });
    expect(wrong.statusCode).toBe(400);

    const right = await app.inject({
      method: "POST",
      url: "/sources",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { kind: "msmail", displayName: "Outlook", oauthAccountId: ms!.id },
    });
    expect(right.statusCode).toBe(201);
    expect(right.json().oauth_account_id).toBe(ms!.id);
  });

  it("gates /auth/microsoft/url link intent on a Bearer token", async () => {
    const anon = await app.inject({ method: "GET", url: "/auth/microsoft/url?mode=web&intent=link" });
    expect(anon.statusCode).toBe(401);

    const alice = await register("alice-mslink@example.com");
    const authed = await app.inject({
      method: "GET",
      url: "/auth/microsoft/url?mode=web&intent=link",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(authed.statusCode).toBe(200);
    expect(authed.json().url).toContain("login.microsoftonline.com");
  });
});
