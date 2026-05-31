import { config as loadEnv } from "dotenv";
import pg from "pg";
import { resetSchema } from "../db/schema.js";

/**
 * Vitest global setup. Runs once before the suite:
 *   1. loads .env,
 *   2. (re)creates a dedicated test database,
 *   3. applies the schema to it.
 *
 * Tests then connect via TEST_DATABASE_URL. Requires the Postgres container to
 * be up (`pnpm infra:up`).
 */
export default async function setup(): Promise<void> {
  loadEnv();

  const testUrl =
    process.env.TEST_DATABASE_URL ??
    "postgres://mnemosyne:mnemosyne@localhost:5432/mnemosyne_test";
  process.env.TEST_DATABASE_URL = testUrl;
  process.env.VECTOR_DIM ??= "1024";
  const vectorDim = Number(process.env.VECTOR_DIM);

  const dbName = new URL(testUrl).pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Unsafe test database name: ${dbName}`);
  }

  // Connect to the maintenance DB to (re)create the test DB from scratch.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }

  await resetSchema(testUrl, vectorDim);
}
