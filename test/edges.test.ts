import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getNeighbors, insertEdge, upsertEntity } from "../services/db/index.js";
import { testDb, truncateAll } from "./helpers.js";

const db = testDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.destroy());

/** Build a chain a -[knows]-> b -[knows]-> c -[knows]-> d. */
async function chain() {
  const [a, b, c, d] = await Promise.all([
    upsertEntity(db, { type: "person", canonicalName: "A" }),
    upsertEntity(db, { type: "person", canonicalName: "B" }),
    upsertEntity(db, { type: "person", canonicalName: "C" }),
    upsertEntity(db, { type: "person", canonicalName: "D" }),
  ]);
  await insertEdge(db, { srcId: a.id, dstId: b.id, rel: "knows" });
  await insertEdge(db, { srcId: b.id, dstId: c.id, rel: "knows" });
  await insertEdge(db, { srcId: c.id, dstId: d.id, rel: "knows" });
  return { a, b, c, d };
}

describe("getNeighbors (recursive CTE, multi-hop)", () => {
  it("returns direct neighbors at depth 1", async () => {
    const { a, b } = await chain();
    const n = await getNeighbors(db, a.id, undefined, 1);
    expect(n.map((x) => x.nodeId)).toEqual([b.id]);
    expect(n[0]?.entity?.canonical_name).toBe("B");
  });

  it("walks multiple hops up to the requested depth", async () => {
    const { a, b, c, d } = await chain();

    const d2 = await getNeighbors(db, a.id, undefined, 2);
    expect(new Set(d2.map((x) => x.nodeId))).toEqual(new Set([b.id, c.id]));

    const d3 = await getNeighbors(db, a.id, undefined, 3);
    expect(new Set(d3.map((x) => x.nodeId))).toEqual(new Set([b.id, c.id, d.id]));
    expect(d3.find((x) => x.nodeId === d.id)?.depth).toBe(3);
  });

  it("filters by relationship type", async () => {
    const { a, b, c } = await chain();
    await insertEdge(db, { srcId: a.id, dstId: c.id, rel: "blocked" });

    const knows = await getNeighbors(db, a.id, "knows", 1);
    expect(knows.map((x) => x.nodeId)).toEqual([b.id]);

    const blocked = await getNeighbors(db, a.id, "blocked", 1);
    expect(blocked.map((x) => x.nodeId)).toEqual([c.id]);
  });

  it("does not loop forever on cycles", async () => {
    const { a, b, c, d } = await chain();
    await insertEdge(db, { srcId: b.id, dstId: a.id, rel: "knows" }); // a<->b cycle
    const n = await getNeighbors(db, a.id, "knows", 3);
    // Simple-path traversal: terminates and never revisits the start node.
    expect(n.find((x) => x.nodeId === a.id)).toBeUndefined();
    expect(new Set(n.map((x) => x.nodeId))).toEqual(new Set([b.id, c.id, d.id]));
  });
});
