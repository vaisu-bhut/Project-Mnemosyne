import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { EntitiesTable, EpisodesTable, FactsTable } from "../types.js";
import { toVector } from "../vector.js";

type Episode = Selectable<EpisodesTable>;
type Fact = Selectable<FactsTable>;
type Entity = Selectable<EntitiesTable>;

/** A search hit plus its cosine distance (0 = identical, 2 = opposite). */
export type WithDistance<T> = T & { distance: number };

export interface SearchOptions {
  /** Source ids whose content the Guardian has hidden for this context. */
  excludeSourceIds?: string[];
  /** Restrict to a single source (page-context scoping). */
  sourceId?: string;
  /** Facts: restrict to those whose subject OR object is this entity. */
  subjectId?: string;
  /** Episodes: restrict to those this entity is `mentioned_in` (via edges). */
  mentionedByEntityId?: string;
  /** Episodes: restrict to a single kind (e.g. "email"). */
  kind?: string;
}

// NOTE: `<=>` is pgvector's cosine-distance operator, matched by the
// vector_cosine_ops HNSW indexes created in the migration.

// All KNN queries are scoped to a user — recall never crosses the boundary.

/** SQL fragment excluding hidden sources (empty when nothing is hidden). */
function denyClause(excludeSourceIds?: string[]) {
  return excludeSourceIds && excludeSourceIds.length
    ? sql`AND source_id <> ALL(${excludeSourceIds}::uuid[])`
    : sql``;
}

/** Restrict to a single source id (page-context scoping). */
function sourceClause(sourceId?: string) {
  return sourceId ? sql`AND source_id = ${sourceId}::uuid` : sql``;
}

/** Cosine KNN over episode embeddings (user-scoped, Guardian-filtered). */
export async function searchEpisodesByVector(
  db: Db,
  userId: string,
  embedding: number[],
  k: number,
  opts: SearchOptions = {},
): Promise<WithDistance<Episode>[]> {
  const vec = toVector(embedding);
  const mentioned = opts.mentionedByEntityId
    ? sql`AND id IN (
        SELECT dst_id FROM edges
        WHERE user_id = ${userId} AND src_id = ${opts.mentionedByEntityId}::uuid
          AND rel = 'mentioned_in'
      )`
    : sql``;
  const kindClause = opts.kind ? sql`AND kind = ${opts.kind}` : sql``;
  const res = await sql<WithDistance<Episode>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM episodes
    WHERE user_id = ${userId} AND embedding IS NOT NULL
      ${denyClause(opts.excludeSourceIds)}
      ${sourceClause(opts.sourceId)}
      ${mentioned}
      ${kindClause}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}

/** Cosine KNN over fact embeddings (user-scoped, active only, Guardian-filtered). */
export async function searchFactsByVector(
  db: Db,
  userId: string,
  embedding: number[],
  k: number,
  opts: SearchOptions = {},
): Promise<WithDistance<Fact>[]> {
  const vec = toVector(embedding);
  const subject = opts.subjectId
    ? sql`AND (subject_id = ${opts.subjectId}::uuid OR object_id = ${opts.subjectId}::uuid)`
    : sql``;
  const res = await sql<WithDistance<Fact>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM facts
    WHERE user_id = ${userId} AND status = 'active' AND embedding IS NOT NULL
      ${denyClause(opts.excludeSourceIds)}
      ${sourceClause(opts.sourceId)}
      ${subject}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}

/**
 * Cosine KNN over entity embeddings (user-scoped, Guardian-filtered). An entity
 * is visible only if it has provenance in a non-hidden source — a fact about it,
 * or an edge to an episode from a visible source. So a person known *only* from
 * a hidden (e.g. sensitive) source disappears in that context.
 */
export async function searchEntitiesByVector(
  db: Db,
  userId: string,
  embedding: number[],
  k: number,
  opts: SearchOptions = {},
): Promise<WithDistance<Entity>[]> {
  const vec = toVector(embedding);
  const excluded = opts.excludeSourceIds;
  const visibility =
    excluded && excluded.length
      ? sql`AND (
          EXISTS (SELECT 1 FROM facts f
                  WHERE f.subject_id = entities.id AND f.source_id <> ALL(${excluded}::uuid[]))
          OR EXISTS (SELECT 1 FROM edges e JOIN episodes ep ON ep.id = e.dst_id
                     WHERE e.src_id = entities.id AND ep.source_id <> ALL(${excluded}::uuid[]))
        )`
      : sql``;
  const res = await sql<WithDistance<Entity>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM entities
    WHERE user_id = ${userId} AND embedding IS NOT NULL
      ${visibility}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}
