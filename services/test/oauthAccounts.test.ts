import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getFirstOauthAccount,
  getOauthAccountById,
  linkOauthAccountForUser,
  listOauthAccounts,
} from "../db/index.js";
import { testDb, truncateAll, seedUser } from "./helpers.js";

const db = testDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.destroy());

const base = {
  provider: "google",
  providerAccountId: "google-sub-A",
  accessToken: "enc-access",
  refreshToken: "enc-refresh",
  expiresAt: new Date(Date.now() + 3_600_000),
  scope: "openid email",
  email: "a@example.com",
  displayName: "Account A",
};

describe("linkOauthAccountForUser", () => {
  it("creates, then updates for the same user without nulling the refresh token", async () => {
    const u1 = await seedUser(db);

    const created = await linkOauthAccountForUser(db, { userId: u1, ...base });
    expect(created.status).toBe("created");
    expect(created.account?.email).toBe("a@example.com");
    expect(created.account?.refresh_token).toBe("enc-refresh");

    // Re-link with a fresh access token but NO refresh token (Google omits it on
    // re-consent) — the stored refresh token must survive.
    const updated = await linkOauthAccountForUser(db, {
      userId: u1,
      ...base,
      accessToken: "enc-access-2",
      refreshToken: undefined,
      scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    });
    expect(updated.status).toBe("updated");
    expect(updated.account?.access_token).toBe("enc-access-2");
    expect(updated.account?.refresh_token).toBe("enc-refresh");
    expect(updated.account?.scope).toContain("gmail.readonly");
  });

  it("refuses to steal an account owned by another user (conflict)", async () => {
    const u1 = await seedUser(db);
    const u2 = await seedUser(db);

    const created = await linkOauthAccountForUser(db, { userId: u1, ...base });
    expect(created.status).toBe("created");

    const conflict = await linkOauthAccountForUser(db, { userId: u2, ...base });
    expect(conflict.status).toBe("conflict");
    expect(conflict.conflictUserId).toBe(u1);

    // The account still belongs to u1, not u2.
    const u2accounts = await listOauthAccounts(db, u2);
    expect(u2accounts).toHaveLength(0);
    const u1accounts = await listOauthAccounts(db, u1);
    expect(u1accounts).toHaveLength(1);
  });

  it("scopes listing and by-id lookups to the owner", async () => {
    const u1 = await seedUser(db);
    const u2 = await seedUser(db);
    const { account } = await linkOauthAccountForUser(db, { userId: u1, ...base });

    expect(await getOauthAccountById(db, u1, account!.id)).toBeDefined();
    expect(await getOauthAccountById(db, u2, account!.id)).toBeUndefined();

    const first = await getFirstOauthAccount(db, u1, "google");
    expect(first?.id).toBe(account!.id);
    expect(await getFirstOauthAccount(db, u2, "google")).toBeUndefined();
  });
});
