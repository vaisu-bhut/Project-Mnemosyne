import { sql } from "kysely";
import {
  clearAgentEntries,
  listOpenLoops,
  writeBlackboard,
  type Db,
} from "../db/index.js";

const DAY_MS = 86_400_000;

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
  openThreads: OpenThread[];
}

interface HealthRow {
  id: string;
  canonical_name: string;
  closeness: number | null;
  interactions: number;
  last_contact: Date | null;
}

function daysSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

/** Relationship health for one person: contact recency, frequency, open threads. */
export async function relationshipHealth(
  db: Db,
  entityId: string,
  now = new Date(),
): Promise<RelationshipHealth> {
  const entity = await db
    .selectFrom("entities")
    .select(["id", "canonical_name", "closeness"])
    .where("id", "=", entityId)
    .executeTakeFirstOrThrow();

  const contact = await sql<{ interactions: number; last_contact: Date | null }>`
    SELECT COUNT(DISTINCT ep.id)::int AS interactions, MAX(ep.occurred_at) AS last_contact
    FROM edges e
    JOIN episodes ep ON ep.id = e.dst_id
    WHERE e.src_id = ${entityId} AND e.rel = 'mentioned_in'
  `.execute(db);
  const row = contact.rows[0] ?? { interactions: 0, last_contact: null };

  const loops = await db
    .selectFrom("open_loops")
    .select(["id", "description", "direction"])
    .where("counterparty", "=", entityId)
    .where("status", "=", "open")
    .execute();

  return {
    entityId: entity.id,
    name: entity.canonical_name,
    closeness: entity.closeness,
    interactions: Number(row.interactions),
    lastContactAt: row.last_contact,
    daysSinceContact: daysSince(row.last_contact, now),
    openThreads: loops.map((l) => ({ id: l.id, description: l.description, direction: l.direction })),
  };
}

/** Relationship health across all people (no open-thread detail; for scans). */
export async function relationshipHealthAll(
  db: Db,
  now = new Date(),
): Promise<RelationshipHealth[]> {
  const rows = await sql<HealthRow>`
    SELECT en.id, en.canonical_name, en.closeness,
           COUNT(DISTINCT ep.id)::int AS interactions,
           MAX(ep.occurred_at) AS last_contact
    FROM entities en
    LEFT JOIN edges e ON e.src_id = en.id AND e.rel = 'mentioned_in'
    LEFT JOIN episodes ep ON ep.id = e.dst_id
    WHERE en.type = 'person'
    GROUP BY en.id, en.canonical_name, en.closeness
    ORDER BY last_contact DESC NULLS LAST
  `.execute(db);

  return rows.rows.map((r) => ({
    entityId: r.id,
    name: r.canonical_name,
    closeness: r.closeness,
    interactions: Number(r.interactions),
    lastContactAt: r.last_contact,
    daysSinceContact: daysSince(r.last_contact, now),
    openThreads: [],
  }));
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
  opts: { staleDays?: number; now?: Date; post?: boolean } = {},
): Promise<RelationshipAlert[]> {
  const staleDays = opts.staleDays ?? 30;
  const now = opts.now ?? new Date();

  const health = await relationshipHealthAll(db, now);
  const alerts = health
    .filter((h) => h.interactions >= 1 && h.daysSinceContact !== null && h.daysSinceContact > staleDays)
    .map((h) => ({ entityId: h.entityId, name: h.name, daysSinceContact: h.daysSinceContact! }))
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact);

  if (opts.post) {
    // Self-idempotent: replace prior alerts rather than piling up.
    await clearAgentEntries(db, "people");
    for (const a of alerts) {
      await writeBlackboard(db, {
        kind: "alert",
        agent: "people",
        title: `You haven't connected with ${a.name} in ${a.daysSinceContact} days`,
        entityId: a.entityId,
        salience: Math.min(0.9, 0.5 + a.daysSinceContact / 365),
        payload: { daysSinceContact: a.daysSinceContact },
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
  now = new Date(),
): Promise<{ updated: number }> {
  const res = await sql<{ id: string }>`
    WITH agg AS (
      SELECT en.id,
             COUNT(DISTINCT ep.id)::real AS interactions,
             MAX(ep.occurred_at) AS last_contact
      FROM entities en
      LEFT JOIN edges e ON e.src_id = en.id AND e.rel = 'mentioned_in'
      LEFT JOIN episodes ep ON ep.id = e.dst_id
      WHERE en.type = 'person'
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
export async function listOwedThreads(db: Db) {
  const loops = await listOpenLoops(db, "open");
  return loops.filter((l) => l.direction === "i_owe");
}
