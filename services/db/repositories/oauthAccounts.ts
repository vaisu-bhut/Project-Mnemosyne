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
}

/** Upsert a linked OAuth account (tokens stored encrypted by the caller). */
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
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(["provider", "provider_account_id"]).doUpdateSet({
        user_id: input.userId,
        access_token: input.accessToken ?? null,
        refresh_token: input.refreshToken ?? null,
        expires_at: input.expiresAt ?? null,
        scope: input.scope ?? null,
        updated_at: new Date(),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getOauthAccount(
  db: Db,
  userId: string,
  provider: string,
): Promise<OauthAccount | undefined> {
  return db
    .selectFrom("oauth_accounts")
    .selectAll()
    .where("user_id", "=", userId)
    .where("provider", "=", provider)
    .executeTakeFirst();
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
