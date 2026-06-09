import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { OauthAccountsTable } from "../types.js";

export type OauthAccount = Selectable<OauthAccountsTable>;

export interface UpsertOauthAccountInput {
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken?: string | null; // already encrypted
  refreshToken?: string | null; // already encrypted
  expiresAt?: Date | null;
  scope?: string | null;
  email?: string | null;
  displayName?: string | null;
}

/**
 * Upsert a linked OAuth account (tokens stored encrypted by the caller).
 *
 * SIGN-IN PATH ONLY: claims the (provider, providerAccountId) row for `userId`,
 * because in the sign-in flow the user *is* that external identity (resolved by
 * email). For attaching an account to an already-logged-in user, use
 * `linkOauthAccountForUser`, which refuses to steal an account owned by someone
 * else.
 */
export async function upsertOauthAccount(
  db: Db,
  input: UpsertOauthAccountInput,
): Promise<OauthAccount> {
  return db
    .insertInto("oauth_accounts")
    .values({
      user_id: input.userId,
      provider: input.provider,
      provider_account_id: input.providerAccountId,
      access_token: input.accessToken ?? null,
      refresh_token: input.refreshToken ?? null,
      expires_at: input.expiresAt ?? null,
      scope: input.scope ?? null,
      email: input.email ?? null,
      display_name: input.displayName ?? null,
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(["provider", "provider_account_id"]).doUpdateSet({
        user_id: input.userId,
        access_token: input.accessToken ?? null,
        // Never clobber an existing refresh token with null: Google only returns
        // one on first consent.
        ...(input.refreshToken ? { refresh_token: input.refreshToken } : {}),
        expires_at: input.expiresAt ?? null,
        scope: input.scope ?? null,
        ...(input.email ? { email: input.email } : {}),
        ...(input.displayName ? { display_name: input.displayName } : {}),
        updated_at: new Date(),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface LinkOauthAccountResult {
  status: "created" | "updated" | "conflict";
  account?: OauthAccount;
  /** When status === "conflict": the user that already owns the account. */
  conflictUserId?: string;
}

/**
 * Attach an external account to an already-logged-in user (the "link" flow).
 *
 * Unlike `upsertOauthAccount`, this NEVER reassigns an account that already
 * belongs to a different Mnemosyne user — it returns `conflict` instead, so a
 * logged-in attacker can't claim someone else's connected account by completing
 * its consent. Same-user re-link updates tokens/scope/identity (and never nulls
 * an existing refresh token).
 */
export async function linkOauthAccountForUser(
  db: Db,
  input: UpsertOauthAccountInput,
): Promise<LinkOauthAccountResult> {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("oauth_accounts")
      .selectAll()
      .where("provider", "=", input.provider)
      .where("provider_account_id", "=", input.providerAccountId)
      .executeTakeFirst();

    if (existing && existing.user_id !== input.userId) {
      return { status: "conflict", conflictUserId: existing.user_id };
    }

    if (existing) {
      const account = await trx
        .updateTable("oauth_accounts")
        .set({
          access_token: input.accessToken ?? null,
          ...(input.refreshToken ? { refresh_token: input.refreshToken } : {}),
          expires_at: input.expiresAt ?? null,
          scope: input.scope ?? null,
          ...(input.email ? { email: input.email } : {}),
          ...(input.displayName ? { display_name: input.displayName } : {}),
          updated_at: new Date(),
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { status: "updated", account };
    }

    const account = await trx
      .insertInto("oauth_accounts")
      .values({
        user_id: input.userId,
        provider: input.provider,
        provider_account_id: input.providerAccountId,
        access_token: input.accessToken ?? null,
        refresh_token: input.refreshToken ?? null,
        expires_at: input.expiresAt ?? null,
        scope: input.scope ?? null,
        email: input.email ?? null,
        display_name: input.displayName ?? null,
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { status: "created", account };
  });
}

/** List a user's connected accounts (oldest first — stable ordering). */
export async function listOauthAccounts(
  db: Db,
  userId: string,
): Promise<OauthAccount[]> {
  return db
    .selectFrom("oauth_accounts")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "asc")
    .execute();
}

/** Fetch one of a user's accounts by id (owner-scoped; undefined if not owned). */
export async function getOauthAccountById(
  db: Db,
  userId: string,
  id: string,
): Promise<OauthAccount | undefined> {
  return db
    .selectFrom("oauth_accounts")
    .selectAll()
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

/**
 * The user's first (oldest) account for a provider. Used as the legacy fallback
 * for sources with no explicit oauth_account_id binding.
 */
export async function getFirstOauthAccount(
  db: Db,
  userId: string,
  provider: string,
): Promise<OauthAccount | undefined> {
  return db
    .selectFrom("oauth_accounts")
    .selectAll()
    .where("user_id", "=", userId)
    .where("provider", "=", provider)
    .orderBy("created_at", "asc")
    .limit(1)
    .executeTakeFirst();
}

/** @deprecated Prefer `getFirstOauthAccount` (deterministic) or `getOauthAccountById`. */
export async function getOauthAccount(
  db: Db,
  userId: string,
  provider: string,
): Promise<OauthAccount | undefined> {
  return getFirstOauthAccount(db, userId, provider);
}

/** Disconnect (delete) one of a user's accounts. Returns whether a row was removed. */
export async function deleteOauthAccount(
  db: Db,
  userId: string,
  id: string,
): Promise<boolean> {
  const res = await db
    .deleteFrom("oauth_accounts")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return (res.numDeletedRows ?? 0n) > 0n;
}

/** Persist refreshed tokens (already encrypted). */
export async function updateOauthTokens(
  db: Db,
  id: string,
  input: { accessToken: string; expiresAt: Date | null; refreshToken?: string | null },
): Promise<void> {
  await db
    .updateTable("oauth_accounts")
    .set({
      access_token: input.accessToken,
      expires_at: input.expiresAt,
      ...(input.refreshToken ? { refresh_token: input.refreshToken } : {}),
      updated_at: new Date(),
    })
    .where("id", "=", id)
    .execute();
}
