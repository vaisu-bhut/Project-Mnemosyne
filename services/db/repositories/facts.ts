import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { FactsTable, FactStatus } from "../types.js";
import { toVector } from "../vector.js";

export type Fact = Selectable<FactsTable>;

export interface InsertFactInput {
  userId: string;
  subjectId: string;
  statement: string;
  predicate?: string | null;
  objectId?: string | null;
  confidence?: number;
  /** Provenance — both are mandatory. */
  sourceEpisode: string;
  sourceId: string;
  contradicts?: string | null;
  status?: FactStatus;
  embedding?: number[] | null;
}

/**
 * Insert a semantic fact. Provenance is mandatory: a fact with no source
 * episode and source is a floating assertion, which the product forbids. We
 * throw before touching the DB (the columns are also NOT NULL as a backstop).
 */
export async function insertFact(db: Db, input: InsertFactInput): Promise<Fact> {
  if (!input.sourceEpisode || !input.sourceId) {
    throw new Error(
      "insertFact: provenance is mandatory — sourceEpisode and sourceId are required",
    );
  }

  return db
    .insertInto("facts")
    .values({
      user_id: input.userId,
      subject_id: input.subjectId,
      statement: input.statement,
      predicate: input.predicate ?? null,
      object_id: input.objectId ?? null,
      confidence: input.confidence,
      source_episode: input.sourceEpisode,
      source_id: input.sourceId,
      contradicts: input.contradicts ?? null,
      status: input.status,
      embedding: input.embedding != null ? toVector(input.embedding) : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface ListFactsOptions {
  limit?: number;
  offset?: number;
  status?: FactStatus;
  /** Restrict to facts whose subject is this entity. */
  subjectId?: string;
  /** Guardian-hidden sources to exclude in this context. */
  excludeSourceIds?: string[];
}

/** List a user's facts, most-reinforced first (for the Facts browser). */
export async function listFacts(
  db: Db,
  userId: string,
  opts: ListFactsOptions = {},
): Promise<Fact[]> {
  let q = db.selectFrom("facts").selectAll().where("user_id", "=", userId);
  if (opts.status) q = q.where("status", "=", opts.status);
  if (opts.subjectId) q = q.where("subject_id", "=", opts.subjectId);
  if (opts.excludeSourceIds && opts.excludeSourceIds.length) {
    q = q.where("source_id", "not in", opts.excludeSourceIds);
  }
  return q
    .orderBy("reinforced", "desc")
    .orderBy("learned_at", "desc")
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)
    .execute();
}

export interface UpdateFactInput {
  statement?: string;
  status?: FactStatus;
}

/** Edit a derived fact (statement and/or status). Owner-scoped. Episodes — the
 * proof — are never touched; only the interpretation changes. */
export async function updateFact(
  db: Db,
  userId: string,
  id: string,
  patch: UpdateFactInput,
): Promise<Fact | undefined> {
  return db
    .updateTable("facts")
    .set({
      ...(patch.statement !== undefined ? { statement: patch.statement } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .returningAll()
    .executeTakeFirst();
}

/** Delete a derived fact (owner-scoped). First clears any `contradicts` pointers
 * referencing it (FK), then removes the row. The source episode remains as
 * proof, so removing the interpretation is safe. Returns whether a row went. */
export async function deleteFact(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("facts")
      .set({ contradicts: null })
      .where("user_id", "=", userId)
      .where("contradicts", "=", id)
      .execute();
    const res = await trx
      .deleteFrom("facts")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0n) > 0;
  });
}

/**
 * Reinforce a fact: bump the `reinforced` counter and stamp last_confirmed=now().
 * This is how repeatedly-observed facts gain trust over time.
 */
export async function reinforceFact(db: Db, factId: string): Promise<Fact> {
  return db
    .updateTable("facts")
    .set({
      reinforced: sql<number>`reinforced + 1`,
      last_confirmed: new Date(),
    })
    .where("id", "=", factId)
    .returningAll()
    .executeTakeFirstOrThrow();
}
