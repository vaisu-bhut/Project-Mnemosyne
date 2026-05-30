import { sql } from "kysely";
import type { Db } from "../db/index.js";

export interface DecayOptions {
  maxAgeDays?: number;
  /** Facts reinforced at least this many times are kept regardless of age. */
  minReinforced?: number;
  now?: Date;
}

export interface DecayResult {
  staled: number;
}

/**
 * Decay stale knowledge: active facts that were never reconfirmed
 * (last_confirmed IS NULL), reinforced fewer than `minReinforced` times, and
 * older than `maxAgeDays` are marked 'stale'. Frequently-reinforced facts
 * survive — that's the point of reinforcement.
 */
export async function decayFacts(
  db: Db,
  opts: DecayOptions = {},
): Promise<DecayResult> {
  const maxAgeDays = opts.maxAgeDays ?? 90;
  const minReinforced = opts.minReinforced ?? 2;
  const now = opts.now ?? new Date();

  const res = await db
    .updateTable("facts")
    .set({ status: "stale" })
    .where("status", "=", "active")
    .where("last_confirmed", "is", null)
    .where("reinforced", "<", minReinforced)
    .where(
      "learned_at",
      "<",
      sql<Date>`${now}::timestamptz - (${maxAgeDays} || ' days')::interval`,
    )
    .executeTakeFirst();

  return { staled: Number(res.numUpdatedRows ?? 0n) };
}
