import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { OpenLoopsTable, LoopDirection, LoopStatus } from "../types.js";

export type OpenLoop = Selectable<OpenLoopsTable>;

export interface CreateOpenLoopInput {
  userId: string;
  description: string;
  direction: LoopDirection;
  counterparty?: string | null;
  dueAt?: Date | null;
  sourceEpisode?: string | null;
  status?: LoopStatus;
}

/** Record a prospective item / promise (i_owe or they_owe). */
export async function createOpenLoop(
  db: Db,
  input: CreateOpenLoopInput,
): Promise<OpenLoop> {
  return db
    .insertInto("open_loops")
    .values({
      user_id: input.userId,
      description: input.description,
      direction: input.direction,
      counterparty: input.counterparty ?? null,
      due_at: input.dueAt ?? null,
      source_episode: input.sourceEpisode ?? null,
      status: input.status,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** List a user's open loops, newest first, optionally filtered by status. */
export async function listOpenLoops(
  db: Db,
  userId: string,
  status?: LoopStatus,
): Promise<OpenLoop[]> {
  let q = db
    .selectFrom("open_loops")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc");
  if (status) q = q.where("status", "=", status);
  return q.execute();
}
