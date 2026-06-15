import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSource, insertEdge, insertEpisode, upsertEntity } from "../db/index.js";
import { buildPeopleGraph } from "../consolidate/index.js";
import { peopleGraph } from "../agents/index.js";
import { seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();

let userId: string;
beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

/** Put two people in the same episode (so they co-occur). */
async function meeting(sourceId: string, externalId: string, people: { id: string }[]) {
  const ev = await insertEpisode(db, {
    userId,
    occurredAt: new Date(),
    sourceId,
    externalId,
    kind: "calendar_event",
    title: externalId,
  });
  for (const p of people) {
    await insertEdge(db, { userId, srcId: p.id, dstId: ev.id, rel: "mentioned_in" });
  }
  return ev;
}

describe("people graph", () => {
  it("builds weighted co_occurs edges and circles from shared episodes", async () => {
    const source = await createSource(db, {
      userId,
      kind: "gcal",
      displayName: "Work calendar",
      scope: "work",
    });
    const sara = await upsertEntity(db, { userId, type: "person", canonicalName: "Sara" });
    const mike = await upsertEntity(db, { userId, type: "person", canonicalName: "Mike" });
    await meeting(source.id, "sync-1", [sara, mike]);
    await meeting(source.id, "sync-2", [sara, mike]); // a second shared episode → weight 2

    const res = await buildPeopleGraph(db, userId);
    expect(res.edgesBuilt).toBe(2); // one undirected pair stored both ways
    expect(res.peopleClassified).toBe(2);

    const graph = await peopleGraph(db, userId);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0]!.weight).toBe(2);
    expect(graph.nodes.every((n) => n.circle === "work")).toBe(true);
  });

  it("is idempotent — re-running does not duplicate edges", async () => {
    const source = await createSource(db, { userId, kind: "gcal", displayName: "Cal", scope: "personal" });
    const a = await upsertEntity(db, { userId, type: "person", canonicalName: "A" });
    const b = await upsertEntity(db, { userId, type: "person", canonicalName: "B" });
    await meeting(source.id, "m1", [a, b]);

    await buildPeopleGraph(db, userId);
    await buildPeopleGraph(db, userId);

    const graph = await peopleGraph(db, userId);
    expect(graph.links).toHaveLength(1);
  });

  it("does not link a person to themselves or to a lone attendee", async () => {
    const source = await createSource(db, { userId, kind: "gcal", displayName: "Cal", scope: "personal" });
    const solo = await upsertEntity(db, { userId, type: "person", canonicalName: "Solo" });
    await meeting(source.id, "alone", [solo]);

    await buildPeopleGraph(db, userId);
    const graph = await peopleGraph(db, userId);
    expect(graph.links).toHaveLength(0);
  });
});
