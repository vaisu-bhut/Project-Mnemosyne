import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { encryptToken, decryptToken, sha256Hex } from "../auth/crypto.js";
import { signAccessToken, signState, verifyAccessToken, verifyState } from "../auth/jwt.js";
import { buildServer } from "../api/server.js";
import { createDb } from "../db/index.js";
import { createArtifactStore } from "../storage/index.js";
import { createQueryEmbedder } from "../embeddings/index.js";
import { createGenerator } from "../llm/index.js";
import { createIngestQueue } from "../queue/index.js";
import { Redis } from "ioredis";
import { parseConfig } from "../config/index.js";
import { devConfig, testDb, truncateAll } from "./helpers.js";

describe("password hashing (scrypt)", () => {
  it("verifies the right password and rejects the wrong one", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });
});

describe("token encryption (AES-256-GCM)", () => {
  it("round-trips and detects tampering", () => {
    const enc = encryptToken("ya29.secret-refresh-token", "key-material");
    expect(decryptToken(enc, "key-material")).toBe("ya29.secret-refresh-token");
    expect(() => decryptToken(enc, "wrong-key")).toThrow();
    expect(sha256Hex("abc")).toHaveLength(64);
  });
});

describe("access tokens (JWT)", () => {
  it("signs and verifies, carrying the user id", async () => {
    const t = await signAccessToken("s3cret", { userId: "u1", email: "a@b.com" }, "15m");
    const claims = await verifyAccessToken("s3cret", t);
    expect(claims.userId).toBe("u1");
    await expect(verifyAccessToken("other", t)).rejects.toThrow();
  });
});

describe("OAuth state tokens", () => {
  it("round-trips the link intent + user id (signed, so unforgeable)", async () => {
    const state = await signState("s3cret", "nonce-1", "web", "link", "user-42");
    const claims = await verifyState("s3cret", state);
    expect(claims).toMatchObject({ nonce: "nonce-1", mode: "web", intent: "link", linkUserId: "user-42" });
    // Wrong signing key fails closed.
    expect(await verifyState("other", state)).toBeNull();
  });

  it("defaults to the sign-in intent with no link user", async () => {
    const claims = await verifyState("s3cret", await signState("s3cret", "n", "json"));
    expect(claims?.intent).toBe("signin");
    expect(claims?.linkUserId).toBeUndefined();
  });
});

// --- End-to-end auth + tenant isolation over HTTP ---------------------------

const config = parseConfig({
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  VECTOR_DIM: String(devConfig.VECTOR_DIM),
  EMBEDDING_PROVIDER: "dev",
  LLM_PROVIDER: "dev",
  JWT_SECRET: "test-secret",
});

const db = testDb();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const app = buildServer({
  db,
  store: createArtifactStore(config),
  redis,
  config,
  queryEmbedder: createQueryEmbedder(config),
  generator: createGenerator(config),
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

async function register(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "password123" },
  });
  return res.json() as { user: { id: string }; accessToken: string };
}

describe("auth HTTP flow + tenant isolation", () => {
  it("rejects protected routes without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/search", payload: { query: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("registers, authenticates, and isolates each user's sources", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    expect(alice.accessToken).toBeTruthy();

    const created = await app.inject({
      method: "POST",
      url: "/sources",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { kind: "filesystem", displayName: "Alice Journal", config: { dir: "/tmp/x" } },
    });
    expect(created.statusCode).toBe(201);
    const sourceId = created.json().id as string;

    // Bob cannot ingest Alice's source — it isn't his.
    const bobTry = await app.inject({
      method: "POST",
      url: `/sources/${sourceId}/ingest`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: {},
    });
    expect(bobTry.statusCode).toBe(404);

    // Alice's /auth/me resolves to Alice.
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(me.json().user.email).toBe("alice@example.com");
  });

  it("logs in with valid credentials and refreshes tokens", async () => {
    await register("carol@example.com");
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "carol@example.com", password: "password123" },
    });
    expect(login.statusCode).toBe(200);
    const { refreshToken } = login.json();

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeTruthy();

    // Old refresh token was rotated out.
    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });
});
