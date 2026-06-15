import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { EpisodesTable } from "../types.js";
import { toVector } from "../vector.js";

export type Episode = Selectable<EpisodesTable>;

export interface InsertEpisodeInput {
  userId: string;
  occurredAt: Date;
  sourceId: string;
  externalId?: string | null;
  kind: string;
  title?: string | null;
  body?: string | null;
  valence?: number | null;
  artifactUri?: string | null;
  embedding?: number[] | null;
  meta?: Record<string, unknown>;
}

/**
 * Insert an episode into the correct monthly partition. Idempotent on
 * (source_id, external_id, occurred_at): on conflict it returns the existing
 * row instead of inserting a duplicate.
 *
 * NOTE: dedup only applies when external_id is non-null (NULLs are distinct in
 * Postgres unique indexes), so a NULL external_id always inserts a fresh row.
 */
export async function insertEpisode(
  db: Db,
  input: InsertEpisodeInput,
): Promise<Episode> {
  const inserted = await db
    .insertInto("episodes")
    .values({
      user_id: input.userId,
      occurred_at: input.occurredAt,
      source_id: input.sourceId,
      external_id: input.externalId ?? null,
      kind: input.kind,
      title: input.title ?? null,
      body: input.body ?? null,
      valence: input.valence ?? null,
      artifact_uri: input.artifactUri ?? null,
      embedding: input.embedding != null ? toVector(input.embedding) : null,
      meta: input.meta,
    })
    .onConflict((oc) =>
      oc.columns(["source_id", "external_id", "occurred_at"]).doNothing(),
    )
    .returningAll()
    .executeTakeFirst();

  if (inserted) return inserted;

  // Conflict path: external_id is guaranteed non-null here (see NOTE above).
  return db
    .selectFrom("episodes")
    .selectAll()
    .where("source_id", "=", input.sourceId)
    .where("external_id", "=", input.externalId as string)
    .where("occurred_at", "=", input.occurredAt)
    .executeTakeFirstOrThrow();
}

/** Fetch a single episode by id, owner-scoped. Scans partitions (id is unique
 * across them). Returns undefined if it doesn't exist or isn't the caller's. */
export async function getEpisode(
  db: Db,
  userId: string,
  id: string,
): Promise<Episode | undefined> {
  return db
    .selectFrom("episodes")
    .selectAll()
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

export interface ListEpisodesOptions {
  limit?: number;
  offset?: number;
  kind?: string;
  sourceId?: string;
  /** Guardian-hidden sources to exclude in this context. */
  excludeSourceIds?: string[];
}

/** List a user's episodes newest-first (for the Episodes browser). */
export async function listEpisodes(
  db: Db,
  userId: string,
  opts: ListEpisodesOptions = {},
): Promise<Episode[]> {
  let q = db.selectFrom("episodes").selectAll().where("user_id", "=", userId);
  if (opts.kind) q = q.where("kind", "=", opts.kind);
  if (opts.sourceId) q = q.where("source_id", "=", opts.sourceId);
  if (opts.excludeSourceIds && opts.excludeSourceIds.length) {
    q = q.where("source_id", "not in", opts.excludeSourceIds);
  }
  return q
    .orderBy("occurred_at", "desc")
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)
    .execute();
}
