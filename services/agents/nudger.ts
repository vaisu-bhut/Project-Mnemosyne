import {
  clearAgentEntries,
  listOpenLoops,
  writeBlackboard,
  type Db,
} from "../db/index.js";
import { relationshipAlerts } from "./people.js";

const DAY_MS = 86_400_000;

export interface NudgerOptions {
  staleDays?: number;
  now?: Date;
}

export interface NudgerResult {
  openLoopNudges: number;
  relationshipAlerts: number;
  total: number;
}

/**
 * The proactive agent that interrupts usefully. Scans open loops and
 * relationship health, then (re)writes salient entries to the blackboard's
 * working memory. Clears its own previous entries first, so it's idempotent.
 */
export async function runNudger(
  db: Db,
  userId: string,
  opts: NudgerOptions = {},
): Promise<NudgerResult> {
  const now = opts.now ?? new Date();
  await clearAgentEntries(db, userId, "nudger");

  // Open loops — promises that may rot.
  const loops = await listOpenLoops(db, userId, "open");
  for (const loop of loops) {
    let salience = loop.direction === "i_owe" ? 0.7 : 0.55;
    let due = "";
    if (loop.due_at) {
      const days = Math.floor((loop.due_at.getTime() - now.getTime()) / DAY_MS);
      if (days < 0) {
        salience = Math.min(0.95, salience + 0.25);
        due = ` (overdue by ${-days}d)`;
      } else if (days <= 3) {
        salience = Math.min(0.95, salience + 0.15);
        due = ` (due in ${days}d)`;
      }
    }
    await writeBlackboard(db, {
      userId,
      kind: "nudge",
      agent: "nudger",
      title: `${loop.direction === "i_owe" ? "You owe" : "Owed to you"}: ${loop.description}${due}`,
      entityId: loop.counterparty,
      salience,
      payload: { loopId: loop.id, direction: loop.direction },
    });
  }

  // Relationship alerts — connections going cold.
  const alerts = await relationshipAlerts(db, userId, { staleDays: opts.staleDays, now, post: true });

  return {
    openLoopNudges: loops.length,
    relationshipAlerts: alerts.length,
    total: loops.length + alerts.length,
  };
}
