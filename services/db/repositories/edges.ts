import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { EdgesTable, EntitiesTable } from "../types.js";

export type Edge = Selectable<EdgesTable>;
type Entity = Selectable<EntitiesTable>;

export interface InsertEdgeInput {
  userId: string;
  srcId: string;
  dstId: string;
  rel: string;
  props?: Record<string, unknown>;
}

/** Insert a directed graph edge (src -> dst) with a relationship label. */
export async function insertEdge(db: Db, input: InsertEdgeInput): Promise<Edge> {
  return db
    .insertInto("edges")
    .values({
      user_id: input.userId,
      src_id: input.srcId,
      dst_id: input.dstId,
      rel: input.rel,
      props: input.props,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface Neighbor {
  /** The reachable node's id (entity or episode id). */
  nodeId: string;
  /** Shortest hop distance from the start node (1..depth). */
  depth: number;
  /** A relationship label on a path that reached this node. */
  rel: string;
  /** The entity row, if this node is an entity; null if it isn't (e.g. an episode). */
  entity: Entity | null;
}

/**
 * Multi-hop neighbor lookup following outgoing edges (src -> dst), via a
 * recursive CTE over the edges table. Depth is clamped to 1..3. Optionally
 * restricts traversal to a single relationship type. Cycles are guarded with a
 * visited-path array, and each node is returned once at its shortest depth.
 */
export async function getNeighbors(
  db: Db,
  userId: string,
  entityId: string,
  rel?: string,
  depth = 1,
): Promise<Neighbor[]> {
  const maxDepth = Math.min(Math.max(Math.trunc(depth), 1), 3);
  const relFilter = rel ?? null;

  const result = await sql<{
    node_id: string;
    depth: number;
    rel: string;
    entity: Entity | null;
  }>`
    WITH RECURSIVE walk AS (
      SELECT
        e.dst_id AS node_id,
        e.rel,
        1 AS depth,
        ARRAY[e.src_id, e.dst_id] AS path
      FROM edges e
      WHERE e.src_id = ${entityId}
        AND e.user_id = ${userId}
        AND (${relFilter}::text IS NULL OR e.rel = ${relFilter})
      UNION ALL
      SELECT
        e.dst_id,
        e.rel,
        w.depth + 1,
        w.path || e.dst_id
      FROM edges e
      JOIN walk w ON e.src_id = w.node_id
      WHERE w.depth < ${maxDepth}
        AND e.user_id = ${userId}
        AND (${relFilter}::text IS NULL OR e.rel = ${relFilter})
        AND NOT (e.dst_id = ANY(w.path))
    ),
    nearest AS (
      SELECT node_id, MIN(depth) AS depth, MIN(rel) AS rel
      FROM walk
      GROUP BY node_id
    )
    SELECT
      n.node_id,
      n.depth,
      n.rel,
      to_jsonb(en.*) AS entity
    FROM nearest n
    LEFT JOIN entities en ON en.id = n.node_id
    ORDER BY n.depth ASC, n.node_id ASC
  `.execute(db);

  return result.rows.map((r) => ({
    nodeId: r.node_id,
    depth: Number(r.depth),
    rel: r.rel,
    entity: r.entity,
  }));
}
