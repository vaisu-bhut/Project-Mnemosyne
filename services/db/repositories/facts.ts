import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { FactsTable, FactStatus } from "../types.js";
import { toVector } from "../vector.js";

export type Fact = Selectable<FactsTable>;

export interface InsertFactInput {
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
