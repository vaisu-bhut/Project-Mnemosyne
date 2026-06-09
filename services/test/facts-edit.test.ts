import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  classifySource,
  createSource,
  deleteFact,
  insertEpisode,
  insertFact,
  listFacts,
  updateFact,
  upsertEntity,
} from "../db/index.js";
import { seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();

let userId: string;
let subjectId: string;
let srcId: string;
let epId: string;

beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
  subjectId = (await upsertEntity(db, { userId, type: "person", canonicalName: "Subj" })).id;
  srcId = (await createSource(db, { userId, kind: "test", displayName: "S" })).id;
  epId = (
    await insertEpisode(db, {
      userId,
      occurredAt: new Date(),
      sourceId: srcId,
      externalId: "e1",
      kind: "note",
      body: "b",
    })
  ).id;
});
afterAll(() => db.destroy());

function fact(statement: string, contradicts?: string) {
  return insertFact(db, { userId, subjectId, statement, sourceEpisode: epId, sourceId: srcId, contradicts });
}

describe("fact editing", () => {
  it("updates statement and status, owner-scoped", async () => {
    const f = await fact("old wording");
    const updated = await updateFact(db, userId, f.id, { statement: "new wording", status: "stale" });
    expect(updated?.statement).toBe("new wording");
    expect(updated?.status).toBe("stale");

    const other = await seedUser(db);
    expect(await updateFact(db, other, f.id, { statement: "hax" })).toBeUndefined();
  });

  it("deletes a fact even when another fact references it via contradicts", async () => {
    const a = await fact("A");
    const b = await fact("B", a.id); // b.contradicts -> a
    expect(b.contradicts).toBe(a.id);

    expect(await deleteFact(db, userId, a.id)).toBe(true);

    const remaining = await listFacts(db, userId, {});
    expect(remaining.map((f) => f.id)).toEqual([b.id]);
    // The referencing pointer was cleared, not left dangling.
    expect(remaining[0]!.contradicts).toBeNull();
  });

  it("does not delete another user's fact", async () => {
    const f = await fact("mine");
    const other = await seedUser(db);
    expect(await deleteFact(db, other, f.id)).toBe(false);
    expect((await listFacts(db, userId, {})).length).toBe(1);
  });
});

describe("source permissions", () => {
  it("defaults to read-only and persists explicit permissions on create + classify", async () => {
    const def = await createSource(db, { userId, kind: "test", displayName: "Def" });
    expect(def.permissions).toEqual({ read: true, write: false, delete: false, mode: "approval" });

    const withPerms = await createSource(db, {
      userId,
      kind: "test",
      displayName: "Perms",
      permissions: { read: true, write: true, delete: false, mode: "autonomous" },
    });
    expect(withPerms.permissions).toMatchObject({ write: true, mode: "autonomous" });

    const classified = await classifySource(db, userId, def.id, {
      permissions: { read: true, write: true, delete: true, mode: "approval" },
    });
    expect(classified?.permissions).toMatchObject({ write: true, delete: true });
  });
});
