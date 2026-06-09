import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSource,
  insertEpisode,
  insertFact,
  listEpisodes,
  listFacts,
  upsertEntity,
  type Episode,
} from "../db/index.js";
import { seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();

let userId: string;
let subjectId: string;
let srcA: string; // personal (visible)
let srcB: string; // sensitive (hideable)

beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
  subjectId = (await upsertEntity(db, { userId, type: "person", canonicalName: "Subj" })).id;
  srcA = (
    await createSource(db, { userId, kind: "test", displayName: "A", scope: "personal" })
  ).id;
  srcB = (
    await createSource(db, {
      userId,
      kind: "test",
      displayName: "B",
      scope: "health",
      sensitive: true,
    })
  ).id;
});
afterAll(() => db.destroy());

function ep(sourceId: string, i: number): Promise<Episode> {
  return insertEpisode(db, {
    userId,
    occurredAt: new Date(2026, 0, 1 + i),
    sourceId,
    externalId: `e-${sourceId}-${i}`,
    kind: "note",
    title: `T${i}`,
    body: `body ${i}`,
  });
}

describe("listEpisodes", () => {
  it("returns newest-first, paginates, and excludes hidden sources", async () => {
    for (let i = 0; i < 5; i++) await ep(srcA, i);
    for (let i = 0; i < 3; i++) await ep(srcB, i);

    const all = await listEpisodes(db, userId, {});
    expect(all.length).toBe(8);
    expect(all[0]!.occurred_at.getTime()).toBeGreaterThanOrEqual(all[1]!.occurred_at.getTime());

    const page = await listEpisodes(db, userId, { limit: 3, offset: 0 });
    expect(page.length).toBe(3);
    const page2 = await listEpisodes(db, userId, { limit: 3, offset: 3 });
    expect(page2[0]!.id).not.toBe(page[0]!.id);

    const visible = await listEpisodes(db, userId, { excludeSourceIds: [srcB] });
    expect(visible.length).toBe(5);
    expect(visible.every((e) => e.source_id === srcA)).toBe(true);
  });
});

describe("listFacts", () => {
  it("filters by status and excludes hidden sources", async () => {
    const eA = await ep(srcA, 0);
    const eB = await ep(srcB, 1);
    await insertFact(db, { userId, subjectId, statement: "f1", sourceEpisode: eA.id, sourceId: srcA });
    await insertFact(db, {
      userId,
      subjectId,
      statement: "f2",
      sourceEpisode: eA.id,
      sourceId: srcA,
      status: "stale",
    });
    await insertFact(db, { userId, subjectId, statement: "fB", sourceEpisode: eB.id, sourceId: srcB });

    expect((await listFacts(db, userId, {})).length).toBe(3);
    expect((await listFacts(db, userId, { status: "active" })).length).toBe(2);

    const visible = await listFacts(db, userId, { excludeSourceIds: [srcB] });
    expect(visible.length).toBe(2);
    expect(visible.every((f) => f.source_id === srcA)).toBe(true);
  });
});
