import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { EntitiesTable, EpisodesTable, FactsTable } from "../types.js";
import { toVector } from "../vector.js";

type Episode = Selectable<EpisodesTable>;
type Fact = Selectable<FactsTable>;
type Entity = Selectable<EntitiesTable>;

/** A search hit plus its cosine distance (0 = identical, 2 = opposite). */
export type WithDistance<T> = T & { distance: number };

// NOTE: `<=>` is pgvector's cosine-distance operator, matched by the
// vector_cosine_ops HNSW indexes created in the migration.

// All KNN queries are scoped to a user — recall never crosses the boundary.

/** Cosine KNN over episode embeddings (user-scoped). */
export async function searchEpisodesByVector(
  db: Db,
  userId: string,
  embedding: number[],
  k: number,
): Promise<WithDistance<Episode>[]> {
  const vec = toVector(embedding);
  const res = await sql<WithDistance<Episode>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM episodes
    WHERE user_id = ${userId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}

/** Cosine KNN over fact embeddings (user-scoped, active only). */
export async function searchFactsByVector(
  db: Db,
  userId: string,
  embedding: number[],
  k: number,
): Promise<WithDistance<Fact>[]> {
  const vec = toVector(embedding);
  const res = await sql<WithDistance<Fact>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM facts
    WHERE user_id = ${userId} AND status = 'active' AND embedding IS NOT NULL
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
