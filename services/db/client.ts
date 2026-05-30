import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./types.js";

export type Db = Kysely<Database>;

/**
 * Create a Kysely instance backed by a pg connection pool.
 * Call `db.destroy()` to close the pool (e.g. in test teardown / shutdown).
 */
export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
