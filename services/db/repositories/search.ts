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

/** Cosine KNN over episode embeddings. */
export async function searchEpisodesByVector(
  db: Db,
  embedding: number[],
  k: number,
): Promise<WithDistance<Episode>[]> {
  const vec = toVector(embedding);
  const res = await sql<WithDistance<Episode>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM episodes
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}

/** Cosine KNN over fact embeddings. */
export async function searchFactsByVector(
  db: Db,
  embedding: number[],
  k: number,
): Promise<WithDistance<Fact>[]> {
  const vec = toVector(embedding);
  const res = await sql<WithDistance<Fact>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM facts
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}

/** Cosine KNN over entity embeddings. */
export async function searchEntitiesByVector(
  db: Db,
  embedding: number[],
  k: number,
): Promise<WithDistance<Entity>[]> {
  const vec = toVector(embedding);
  const res = await sql<WithDistance<Entity>>`
    SELECT *, embedding <=> ${vec}::vector AS distance
    FROM entities
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `.execute(db);
  return res.rows;
}
