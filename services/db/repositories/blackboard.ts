import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { BlackboardTable } from "../types.js";

export type BlackboardEntry = Selectable<BlackboardTable>;

export interface WriteBlackboardInput {
  userId: string;
  kind: string;
  agent: string;
  title: string;
  body?: string | null;
  entityId?: string | null;
  salience?: number;
  payload?: Record<string, unknown>;
  expiresAt?: Date | null;
}

/** Write a working-memory entry to the blackboard. */
export async function writeBlackboard(
  db: Db,
  input: WriteBlackboardInput,
): Promise<BlackboardEntry> {
  return db
    .insertInto("blackboard")
    .values({
      user_id: input.userId,
      kind: input.kind,
      agent: input.agent,
      title: input.title,
      body: input.body ?? null,
      entity_id: input.entityId ?? null,
      salience: input.salience,
      payload: input.payload,
      expires_at: input.expiresAt ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** "What's on my mind": a user's top-salience active, unexpired entries. */
export async function listMind(
  db: Db,
  userId: string,
  k = 10,
): Promise<BlackboardEntry[]> {
  return db
    .selectFrom("blackboard")
    .selectAll()
    .where("user_id", "=", userId)
    .where("status", "=", "active")
    .where((eb) =>
      eb.or([eb("expires_at", "is", null), eb("expires_at", ">", sql<Date>`now()`)]),
    )
    .orderBy("salience", "desc")
    .orderBy("created_at", "desc")
    .limit(k)
    .execute();
}

/** Dismiss an entry (scoped to its owner). */
export async function dismissBlackboard(
  db: Db,
  userId: string,
  id: string,
): Promise<void> {
  await db
    .updateTable("blackboard")
    .set({ status: "dismissed" })
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .execute();
}

/** Remove an agent's active entries for a user before it rewrites them. */
export async function clearAgentEntries(
  db: Db,
  userId: string,
  agent: string,
): Promise<void> {
  await db
    .deleteFrom("blackboard")
    .where("user_id", "=", userId)
    .where("agent", "=", agent)
    .where("status", "=", "active")
    .execute();
}
