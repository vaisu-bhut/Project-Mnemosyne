import {
  activeSnoozedKeys,
  clearAgentEntries,
  listOpenLoops,
  writeBlackboard,
  type Db,
} from "../db/index.js";
import { listContradictions } from "../consolidate/index.js";
import { relationshipAlerts } from "./people.js";

const DAY_MS = 86_400_000;

export interface NudgerOptions {
  staleDays?: number;
  now?: Date;
}

export interface NudgerResult {
  openLoopNudges: number;
  commitmentNudges: number;
  contradictionNudges: number;
  relationshipAlerts: number;
  total: number;
}

/**
 * The proactive agent that interrupts usefully. Scans open loops (promises),
 * approaching/overdue commitments, contradictions worth resolving, and
 * relationship health, then (re)writes salient entries to the blackboard.
 * Clears its own previous entries first, so it's idempotent — and skips any
 * nudge the user has snoozed into the future (keyed to the source, not the row).
 */
export async function runNudger(
  db: Db,
  userId: string,
  opts: NudgerOptions = {},
): Promise<NudgerResult> {
  const now = opts.now ?? new Date();
  const snoozed = await activeSnoozedKeys(db, userId, now);
  await clearAgentEntries(db, userId, "nudger");

  // Open loops — promises that may rot. A due date makes one an "approaching
  // commitment" (its own kind, with deadline-aware salience).
  const loops = await listOpenLoops(db, userId, "open");
  let openLoopNudges = 0;
  let commitmentNudges = 0;
  for (const loop of loops) {
    const key = `loop:${loop.id}`;
    if (snoozed.has(key)) continue;

    let salience = loop.direction === "i_owe" ? 0.7 : 0.55;
    let due = "";
    let isCommitment = false;
    if (loop.due_at) {
      const days = Math.floor((loop.due_at.getTime() - now.getTime()) / DAY_MS);
      if (days < 0) {
        salience = Math.min(0.95, salience + 0.25);
        due = ` (overdue by ${-days}d)`;
        isCommitment = true;
      } else if (days <= 3) {
        salience = Math.min(0.95, salience + 0.15);
        due = ` (due in ${days}d)`;
        isCommitment = true;
      } else if (days <= 14) {
        due = ` (due in ${days}d)`;
        isCommitment = true;
      }
    }
    await writeBlackboard(db, {
      userId,
      kind: isCommitment ? "commitment" : "nudge",
      agent: "nudger",
      title: `${loop.direction === "i_owe" ? "You owe" : "Owed to you"}: ${loop.description}${due}`,
      entityId: loop.counterparty,
      salience,
      payload: {
        key,
        loopId: loop.id,
        direction: loop.direction,
        ...(loop.due_at ? { dueAt: loop.due_at.toISOString() } : {}),
      },
    });
    if (isCommitment) commitmentNudges++;
    else openLoopNudges++;
  }

  // Contradictions worth resolving — consolidation flags them; we surface each
  // pair once with both statements so the user can say which is current.
  const contradictions = await listContradictions(db, userId);
  const seenPairs = new Set<string>();
  let contradictionNudges = 0;
  for (const c of contradictions) {
    const pair = [c.id, c.contradictsId].sort();
    const key = `contradiction:${pair.join(":")}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    if (snoozed.has(key)) continue;
    await writeBlackboard(db, {
      userId,
      kind: "contradiction",
      agent: "nudger",
      title: "Conflicting facts — which is current?",
      body: `“${c.statement}”\nvs.\n“${c.contradictsStatement}”`,
      salience: 0.62,
      payload: {
        key,
        factId: c.id,
        contradictsId: c.contradictsId,
        ...(c.episode ? { episode: c.episode } : {}),
      },
    });
    contradictionNudges++;
  }

  // Relationship alerts — connections going cold (snooze-aware).
  const alerts = await relationshipAlerts(db, userId, {
    staleDays: opts.staleDays,
    now,
    post: true,
    snoozedKeys: snoozed,
  });

  return {
    openLoopNudges,
    commitmentNudges,
    contradictionNudges,
    relationshipAlerts: alerts.length,
    total: openLoopNudges + commitmentNudges + contradictionNudges + alerts.length,
  };
}
