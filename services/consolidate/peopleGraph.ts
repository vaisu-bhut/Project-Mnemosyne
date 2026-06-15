import { sql } from "kysely";
import type { Db } from "../db/index.js";

/**
 * Builds the multi-dimensional people graph from existing memory — no new
 * ingestion. Two dimensions are materialized here; closeness (your bond) already
 * lives on entities.closeness and is read at query time.
 *
 *  1. Connection — person↔person `co_occurs` edges: two people mentioned in the
 *     same episode (a thread, a meeting, a note). Weight = how many episodes they
 *     share; props also carry the most recent co-occurrence.
 *  2. Circle — each person's relation context (work / personal / health /
 *     shareable), derived deterministically from the dominant *scope* of the
 *     sources they appear in, written to entities.attrs.circle.
 *
 * Idempotent: clears prior `co_occurs` edges first, so it's safe to re-run on a
 * schedule. Pairs from very large episodes (mailing lists) are skipped to avoid
 * an O(n²) attendee explosion.
 */

const MAX_EPISODE_ATTENDEES = 30;

export interface PeopleGraphResult {
  /** Directed rows inserted (each undirected pair becomes two rows). */
  edgesBuilt: number;
  /** People assigned a circle. */
  peopleClassified: number;
}

interface PairRow {
  a: string;
  b: string;
  cnt: number;
  last_seen: Date | null;
}

interface CircleRow {
  person_id: string;
  scope: string | null;
  n: number;
}

export async function buildPeopleGraph(db: Db, userId: string): Promise<PeopleGraphResult> {
  // 1. Connection — co-occurring person pairs, skipping oversized episodes.
  const pairs = await sql<PairRow>`
    WITH ep_people AS (
      SELECT e.dst_id AS episode_id, e.src_id AS person_id, ep.occurred_at
      FROM edges e
      JOIN entities en ON en.id = e.src_id AND en.user_id = ${userId} AND en.type = 'person'
      JOIN episodes ep ON ep.id = e.dst_id
      WHERE e.user_id = ${userId} AND e.rel = 'mentioned_in'
    ),
    ep_counts AS (
      SELECT episode_id, COUNT(*) AS n FROM ep_people GROUP BY episode_id
    )
    SELECT a.person_id AS a, b.person_id AS b,
           COUNT(DISTINCT a.episode_id)::int AS cnt,
           MAX(a.occurred_at) AS last_seen
    FROM ep_people a
    JOIN ep_people b ON a.episode_id = b.episode_id AND a.person_id < b.person_id
    JOIN ep_counts c ON c.episode_id = a.episode_id AND c.n <= ${MAX_EPISODE_ATTENDEES}
    GROUP BY a.person_id, b.person_id
  `.execute(db);

  await db
    .deleteFrom("edges")
    .where("user_id", "=", userId)
    .where("rel", "=", "co_occurs")
    .execute();

  let edgesBuilt = 0;
  if (pairs.rows.length > 0) {
    // Store both directions so getNeighbors() can traverse from either node.
    const values = pairs.rows.flatMap((p) => {
      const props = {
        count: p.cnt,
        lastSeen: p.last_seen ? p.last_seen.toISOString() : null,
      };
      return [
        { user_id: userId, src_id: p.a, dst_id: p.b, rel: "co_occurs", props },
        { user_id: userId, src_id: p.b, dst_id: p.a, rel: "co_occurs", props },
      ];
    });
    await db.insertInto("edges").values(values).execute();
    edgesBuilt = values.length;
  }

  // 2. Circle — modal source scope per person.
  const scopeRows = await sql<CircleRow>`
    SELECT e.src_id AS person_id, src.scope AS scope, COUNT(*)::int AS n
    FROM edges e
    JOIN entities en ON en.id = e.src_id AND en.user_id = ${userId} AND en.type = 'person'
    JOIN episodes ep ON ep.id = e.dst_id
    JOIN sources src ON src.id = ep.source_id
    WHERE e.user_id = ${userId} AND e.rel = 'mentioned_in'
    GROUP BY e.src_id, src.scope
  `.execute(db);

  // Pick the dominant scope per person.
  const best = new Map<string, { scope: string | null; n: number }>();
  for (const r of scopeRows.rows) {
    const cur = best.get(r.person_id);
    if (!cur || r.n > cur.n) best.set(r.person_id, { scope: r.scope, n: r.n });
  }

  let peopleClassified = 0;
  for (const [personId, { scope }] of best) {
    if (!scope) continue;
    await db
      .updateTable("entities")
      .set({ attrs: sql`attrs || ${JSON.stringify({ circle: scope })}::jsonb` })
      .where("id", "=", personId)
      .where("user_id", "=", userId)
      .execute();
    peopleClassified++;
  }

  return { edgesBuilt, peopleClassified };
}
