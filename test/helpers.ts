import { sql } from "kysely";
import { createDb, type Db } from "../services/db/index.js";

export const DIM = Number(process.env.VECTOR_DIM ?? 1024);

/** Offline config for building dev embedder / extractor / generator in tests. */
export const devConfig = {
  EMBEDDING_PROVIDER: "dev",
  EMBEDDING_MODEL: "dev",
  EMBEDDING_BASE_URL: undefined,
  EMBEDDING_API_KEY: undefined,
  EMBEDDING_TASK_TYPE: "RETRIEVAL_DOCUMENT",
  VECTOR_DIM: DIM,
  LLM_PROVIDER: "dev",
  LLM_MODEL: "dev",
} as const;

/** Build a DIM-length embedding with `value` placed at `hotIndex`. */
export function embedding(hotIndex: number, value = 1): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[hotIndex % DIM] = value;
  return v;
}

export function testDb(): Db {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set — globalSetup must run first");
  }
  return createDb(url);
}

/** Wipe all domain tables between tests. */
export async function truncateAll(db: Db): Promise<void> {
  await sql`
    TRUNCATE sources, entities, episodes, facts, edges, open_loops, retention
    RESTART IDENTITY CASCADE
  `.execute(db);
}
