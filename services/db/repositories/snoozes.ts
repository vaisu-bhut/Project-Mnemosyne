import { sql } from "kysely";
import type { Db } from "../client.js";

/**
 * "Remind me later" suppressions for proactive nudges. Keyed by a stable
 * nudge key (e.g. `loop:<id>`, `people:<entityId>`, `contradiction:<a>:<b>`)
 * rather than a blackboard row id, because the Nudger regenerates blackboard
 * entries from source each run — only a source-keyed snooze survives that.
 */

/** Snooze a nudge key until a future time (upsert — re-snoozing extends it). */
export async function snoozeNudge(
  db: Db,
  userId: string,
  nudgeKey: string,
  until: Date,
): Promise<void> {
  await db
    .insertInto("nudge_snoozes")
    .values({ user_id: userId, nudge_key: nudgeKey, snoozed_until: until })
    .onConflict((oc) =>
      oc.columns(["user_id", "nudge_key"]).doUpdateSet({ snoozed_until: until }),
    )
    .execute();
}

/** The set of nudge keys currently snoozed into the future for a user. */
export async function activeSnoozedKeys(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<Set<string>> {
  const rows = await db
    .selectFrom("nudge_snoozes")
    .select("nudge_key")
    .where("user_id", "=", userId)
    .where("snoozed_until", ">", now)
    .execute();
  return new Set(rows.map((r) => r.nudge_key));
}
