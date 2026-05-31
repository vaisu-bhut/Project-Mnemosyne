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

/** Cosine KNN over episode embeddings (user-scoped, Guardian-filtered). */
export async function searchEpisodesByVector(
  db: Db,
  userId: string,
  embedding: number[],
  k: number,
  opts: SearchOptions = {},
): Promise<WithDistance<Episode>[]> {
  const vec = toVector(embedding);
  const res = await sql<WithDistance<Episode>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM episodes
    WHERE user_id = ${userId} AND embedding IS NOT NULL
      ${denyClause(opts.excludeSourceIds)}
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
  const res = await sql<WithDistance<Fact>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM facts
    WHERE user_id = ${userId} AND status = 'active' AND embedding IS NOT NULL
      ${denyClause(opts.excludeSourceIds)}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}

/** Cosine KNN over entity embeddings (user-scoped). */
export async function searchEntitiesByVector(
  db: Db,
  userId: string,
  embedding: number[],
  k: number,
): Promise<WithDistance<Entity>[]> {
  const vec = toVector(embedding);
  const res = await sql<WithDistance<Entity>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM entities
    WHERE user_id = ${userId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}
