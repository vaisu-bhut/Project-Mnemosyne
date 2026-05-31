import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { SessionsTable } from "../types.js";

export type Session = Selectable<SessionsTable>;

/** Store a refresh-token session by its hash (never the raw token). */
export async function createSession(
  db: Db,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<Session> {
  return db
    .insertInto("sessions")
    .values({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function findSessionByHash(
  db: Db,
  tokenHash: string,
): Promise<Session | undefined> {
  return db
    .selectFrom("sessions")
    .selectAll()
    .where("token_hash", "=", tokenHash)
    .executeTakeFirst();
}

export async function deleteSessionByHash(db: Db, tokenHash: string): Promise<void> {
  await db.deleteFrom("sessions").where("token_hash", "=", tokenHash).execute();
}
