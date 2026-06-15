import { sql } from "kysely";
import {
  clearAgentEntries,
  listOpenLoops,
  writeBlackboard,
  type Db,
} from "../db/index.js";

const DAY_MS = 86_400_000;

/** Contact cadence over time: are you talking more, the same, or less than you
 * used to? Computed from interaction frequency, recent window vs. prior window. */
export type RelationshipTrend = "warming" | "steady" | "cooling";

// Windows for the cadence comparison: last 30 days vs. the 30–90-day baseline.
const RECENT_DAYS = 30;
const PRIOR_DAYS = 90;

export interface OpenThread {
  id: string;
  description: string;
  direction: string;
}

export interface RelationshipHealth {
  entityId: string;
  name: string;
  closeness: number | null;
  interactions: number;
  lastContactAt: Date | null;
  daysSinceContact: number | null;
  /** Cadence trend (used-to-talk vs. now). */
  trend: RelationshipTrend;
  /** Interactions in the recent window (last RECENT_DAYS). */
  recentInteractions: number;
  /** Interactions in the prior baseline window (RECENT_DAYS–PRIOR_DAYS ago). */
  priorInteractions: number;
  openThreads: OpenThread[];
}

interface HealthRow {
  id: string;
  canonical_name: string;
  closeness: number | null;
  interactions: number;
  last_contact: Date | null;
  recent: number;
  prior: number;
}

function daysSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

/**
 * Classify cadence by comparing per-day interaction rates in the recent window
 * against the prior baseline. Rates (not raw counts) so the different window
 * lengths compare fairly. Needs a little signal before calling it a trend.
 */
function classifyTrend(recent: number, prior: number): RelationshipTrend {
  const recentRate = recent / RECENT_DAYS;
  const priorRate = prior / (PRIOR_DAYS - RECENT_DAYS);
  if (recent === 0 && prior === 0) return "steady";
  if (priorRate === 0) return recent >= 2 ? "warming" : "steady";
  if (recentRate >= priorRate * 1.5) return "warming";
  if (recentRate <= priorRate * 0.6) return "cooling";
  return "steady";
}

/** Relationship health for one of a user's people. */
export async function relationshipHealth(
  db: Db,
  userId: string,
  entityId: string,
  now = new Date(),
): Promise<RelationshipHealth> {
  const entity = await db
    .selectFrom("entities")
    .select(["id", "canonical_name", "closeness"])
    .where("id", "=", entityId)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();

  const contact = await sql<{
    interactions: number;
    last_contact: Date | null;
    recent: number;
    prior: number;
  }>`
    SELECT COUNT(DISTINCT ep.id)::int AS interactions,
           MAX(ep.occurred_at) AS last_contact,
           COUNT(DISTINCT ep.id) FILTER (
             WHERE ep.occurred_at > ${now}::timestamptz - (${RECENT_DAYS} || ' days')::interval
           )::int AS recent,
           COUNT(DISTINCT ep.id) FILTER (
             WHERE ep.occurred_at <= ${now}::timestamptz - (${RECENT_DAYS} || ' days')::interval
               AND ep.occurred_at > ${now}::timestamptz - (${PRIOR_DAYS} || ' days')::interval
           )::int AS prior
    FROM edges e
    JOIN episodes ep ON ep.id = e.dst_id
    WHERE e.user_id = ${userId} AND e.src_id = ${entityId} AND e.rel = 'mentioned_in'
  `.execute(db);
  const row = contact.rows[0] ?? { interactions: 0, last_contact: null, recent: 0, prior: 0 };

  const loops = await db
    .selectFrom("open_loops")
    .select(["id", "description", "direction"])
    .where("user_id", "=", userId)
    .where("counterparty", "=", entityId)
    .where("status", "=", "open")
    .execute();

  const recent = Number(row.recent);
  const prior = Number(row.prior);
  return {
    entityId: entity.id,
    name: entity.canonical_name,
    closeness: entity.closeness,
    interactions: Number(row.interactions),
    lastContactAt: row.last_contact,
    daysSinceContact: daysSince(row.last_contact, now),
    trend: classifyTrend(recent, prior),
    recentInteractions: recent,
    priorInteractions: prior,
    openThreads: loops.map((l) => ({ id: l.id, description: l.description, direction: l.direction })),
  };
}

/** Relationship health across a user's people (no open-thread detail; for scans). */
export async function relationshipHealthAll(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<RelationshipHealth[]> {
  const rows = await sql<HealthRow>`
    SELECT en.id, en.canonical_name, en.closeness,
           COUNT(DISTINCT ep.id)::int AS interactions,
           MAX(ep.occurred_at) AS last_contact,
           COUNT(DISTINCT ep.id) FILTER (
             WHERE ep.occurred_at > ${now}::timestamptz - (${RECENT_DAYS} || ' days')::interval
           )::int AS recent,
           COUNT(DISTINCT ep.id) FILTER (
             WHERE ep.occurred_at <= ${now}::timestamptz - (${RECENT_DAYS} || ' days')::interval
               AND ep.occurred_at > ${now}::timestamptz - (${PRIOR_DAYS} || ' days')::interval
           )::int AS prior
    FROM entities en
    LEFT JOIN edges e ON e.src_id = en.id AND e.rel = 'mentioned_in' AND e.user_id = ${userId}
    LEFT JOIN episodes ep ON ep.id = e.dst_id
    WHERE en.user_id = ${userId} AND en.type = 'person'
    GROUP BY en.id, en.canonical_name, en.closeness
    ORDER BY last_contact DESC NULLS LAST
  `.execute(db);

  return rows.rows.map((r) => {
    const recent = Number(r.recent);
    const prior = Number(r.prior);
    return {
      entityId: r.id,
      name: r.canonical_name,
      closeness: r.closeness,
      interactions: Number(r.interactions),
      lastContactAt: r.last_contact,
      daysSinceContact: daysSince(r.last_contact, now),
      trend: classifyTrend(recent, prior),
      recentInteractions: recent,
      priorInteractions: prior,
      openThreads: [],
    };
  });
}

export interface RelationshipAlert {
  entityId: string;
  name: string;
  daysSinceContact: number;
}

/**
 * People you've interacted with before but haven't contacted in a while —
 * "you haven't talked to your sister in 6 weeks, which is unusual." Optionally
 * posts each to the blackboard as an alert.
 */
export async function relationshipAlerts(
  db: Db,
  userId: string,
  opts: { staleDays?: number; now?: Date; post?: boolean; snoozedKeys?: Set<string> } = {},
): Promise<RelationshipAlert[]> {
  const staleDays = opts.staleDays ?? 30;
  const now = opts.now ?? new Date();
  const snoozed = opts.snoozedKeys ?? new Set<string>();

  const health = await relationshipHealthAll(db, userId, now);
  const alerts = health
    .filter((h) => h.interactions >= 1 && h.daysSinceContact !== null && h.daysSinceContact > staleDays)
    .map((h) => ({ entityId: h.entityId, name: h.name, daysSinceContact: h.daysSinceContact! }))
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact);

  if (opts.post) {
    await clearAgentEntries(db, userId, "people");
    for (const a of alerts) {
      const key = `people:${a.entityId}`;
      if (snoozed.has(key)) continue;
      await writeBlackboard(db, {
        userId,
        kind: "alert",
        agent: "people",
        title: `You haven't connected with ${a.name} in ${a.daysSinceContact} days`,
        entityId: a.entityId,
        salience: Math.min(0.9, 0.5 + a.daysSinceContact / 365),
        payload: { key, daysSinceContact: a.daysSinceContact },
      });
    }
  }
  return alerts;
}

/**
 * Recompute a 0..1 closeness score per person from interaction frequency and
 * recency, and persist it on entities.closeness.
 */
export async function recomputeCloseness(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<{ updated: number }> {
  const res = await sql<{ id: string }>`
    WITH agg AS (
      SELECT en.id,
             COUNT(DISTINCT ep.id)::real AS interactions,
             MAX(ep.occurred_at) AS last_contact
      FROM entities en
      LEFT JOIN edges e ON e.src_id = en.id AND e.rel = 'mentioned_in' AND e.user_id = ${userId}
      LEFT JOIN episodes ep ON ep.id = e.dst_id
      WHERE en.user_id = ${userId} AND en.type = 'person'
      GROUP BY en.id
    )
    UPDATE entities en
    SET closeness = LEAST(1.0, agg.interactions / 10.0)
      * GREATEST(0.0, 1.0 - EXTRACT(EPOCH FROM (${now}::timestamptz - agg.last_contact)) / (365 * 86400)),
        updated_at = now()
    FROM agg
    WHERE en.id = agg.id AND agg.last_contact IS NOT NULL
    RETURNING en.id
  `.execute(db);
  return { updated: res.rows.length };
}

/** Convenience: open loops the user owes (for surfacing). */
export async function listOwedThreads(db: Db, userId: string) {
  const loops = await listOpenLoops(db, userId, "open");
  return loops.filter((l) => l.direction === "i_owe");
}
