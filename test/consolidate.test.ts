import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenLoop,
  createSource,
  insertEdge,
  insertEpisode,
  insertFact,
  upsertEntity,
  type Source,
} from "../services/db/index.js";
import {
  decayFacts,
  deduplicateFacts,
  detectContradictions,
  enforceRetention,
  forgetEpisode,
  resolveEntities,
  setRetention,
} from "../services/consolidate/index.js";
import { createArtifactStore } from "../services/storage/index.js";
import { seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
let userId: string;

beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function seed(): Promise<{ source: Source; episodeId: string }> {
  const source = await createSource(db, { userId, kind: "test", displayName: "t" });
  const ep = await insertEpisode(db, {
    userId,
    occurredAt: new Date(),
    sourceId: source.id,
    externalId: "e1",
    kind: "note",
  });
  return { source, episodeId: ep.id };
}

describe("deduplicateFacts", () => {
  it("collapses identical facts and reinforces the survivor", async () => {
    const { source, episodeId } = await seed();
    const subject = await upsertEntity(db, { userId, type: "person", canonicalName: "Sara" });
    const common = { userId, subjectId: subject.id, statement: "Sara likes tea.", sourceEpisode: episodeId, sourceId: source.id };
    await insertFact(db, common);
    await insertFact(db, common);

    const r = await deduplicateFacts(db, userId);
    expect(r.retracted).toBe(1);

    const active = await db.selectFrom("facts").selectAll().where("status", "=", "active").execute();
    expect(active).toHaveLength(1);
    expect(active[0]!.reinforced).toBe(2);
  });
});

describe("resolveEntities", () => {
  it("merges a less-specific name into the specific one and repoints facts", async () => {
    const { source, episodeId } = await seed();
    const full = await upsertEntity(db, { userId, type: "person", canonicalName: "Sara Lin" });
    const short = await upsertEntity(db, { userId, type: "person", canonicalName: "Sara" });
    await insertFact(db, { userId, subjectId: short.id, statement: "Sara runs.", sourceEpisode: episodeId, sourceId: source.id });

    const r = await resolveEntities(db, userId);
    expect(r.merged).toBe(1);

    const people = await db.selectFrom("entities").selectAll().where("type", "=", "person").execute();
    expect(people).toHaveLength(1);
    expect(people[0]!.id).toBe(full.id);
    expect(people[0]!.aliases).toContain("Sara");

    const fact = await db.selectFrom("facts").select("subject_id").executeTakeFirstOrThrow();
    expect(fact.subject_id).toBe(full.id);
  });
});

describe("detectContradictions", () => {
  it("links conflicting facts on the same subject+predicate", async () => {
    const { source, episodeId } = await seed();
    const subject = await upsertEntity(db, { userId, type: "person", canonicalName: "Alex" });
    const a = await insertFact(db, { userId, subjectId: subject.id, statement: "Alex works at Acme.", predicate: "employer", sourceEpisode: episodeId, sourceId: source.id });
    const b = await insertFact(db, { userId, subjectId: subject.id, statement: "Alex works at Globex.", predicate: "employer", sourceEpisode: episodeId, sourceId: source.id });
    await db.updateTable("facts").set({ learned_at: daysAgo(10) }).where("id", "=", a.id).execute();
    await db.updateTable("facts").set({ learned_at: daysAgo(1) }).where("id", "=", b.id).execute();

    const r = await detectContradictions(db, userId);
    expect(r.linked).toBe(1);

    const later = await db.selectFrom("facts").select("contradicts").where("id", "=", b.id).executeTakeFirstOrThrow();
    expect(later.contradicts).toBe(a.id);
  });

  it("does not flag paraphrases of the same fact", async () => {
    const { source, episodeId } = await seed();
    const s = await upsertEntity(db, { userId, type: "person", canonicalName: "Cleo" });
    await insertFact(db, { userId, subjectId: s.id, statement: "had dinner at Toscano", predicate: "event", sourceEpisode: episodeId, sourceId: source.id });
    await insertFact(db, { userId, subjectId: s.id, statement: "Cleo had dinner at Toscano.", predicate: "event", sourceEpisode: episodeId, sourceId: source.id });
    expect((await detectContradictions(db, userId)).linked).toBe(0);
  });

  it("ignores 'mentioned' predicates", async () => {
    const { source, episodeId } = await seed();
    const s = await upsertEntity(db, { userId, type: "person", canonicalName: "Bo" });
    await insertFact(db, { userId, subjectId: s.id, statement: "Bo was mentioned in A.", predicate: "mentioned", sourceEpisode: episodeId, sourceId: source.id });
    await insertFact(db, { userId, subjectId: s.id, statement: "Bo was mentioned in B.", predicate: "mentioned", sourceEpisode: episodeId, sourceId: source.id });
    expect((await detectContradictions(db, userId)).linked).toBe(0);
  });
});

describe("decayFacts", () => {
  it("stales old un-reinforced facts but keeps reinforced ones", async () => {
    const { source, episodeId } = await seed();
    const s = await upsertEntity(db, { userId, type: "person", canonicalName: "Kai" });
    const old = await insertFact(db, { userId, subjectId: s.id, statement: "old fact", sourceEpisode: episodeId, sourceId: source.id });
    const strong = await insertFact(db, { userId, subjectId: s.id, statement: "strong fact", sourceEpisode: episodeId, sourceId: source.id });
    await db.updateTable("facts").set({ learned_at: daysAgo(200) }).where("id", "=", old.id).execute();
    await db.updateTable("facts").set({ learned_at: daysAgo(200), reinforced: 5 }).where("id", "=", strong.id).execute();

    const r = await decayFacts(db, userId, { maxAgeDays: 90, minReinforced: 2 });
    expect(r.staled).toBe(1);

    const oldRow = await db.selectFrom("facts").select("status").where("id", "=", old.id).executeTakeFirstOrThrow();
    const strongRow = await db.selectFrom("facts").select("status").where("id", "=", strong.id).executeTakeFirstOrThrow();
    expect(oldRow.status).toBe("stale");
    expect(strongRow.status).toBe("active");
  });
});

describe("enforceRetention", () => {
  it("compresses aged episodes, purges very old ones, spares raw_forever", async () => {
    const store = createArtifactStore({ LOCAL_STORAGE_DIR: tmpdir() });
    const source = await createSource(db, { userId, kind: "test", displayName: "t" });

    const aged = await insertEpisode(db, { userId, occurredAt: daysAgo(200), sourceId: source.id, externalId: "aged", kind: "note", body: "raw aged body" });
    const ancient = await insertEpisode(db, { userId, occurredAt: daysAgo(400), sourceId: source.id, externalId: "ancient", kind: "note", body: "raw ancient body" });
    const kept = await insertEpisode(db, { userId, occurredAt: daysAgo(200), sourceId: source.id, externalId: "kept", kind: "note", body: "keep raw forever" });
    await setRetention(db, userId, kept.id, { tier: "raw_forever" });

    const r = await enforceRetention({ db, store }, userId, { compressAfterDays: 90, purgeAfterDays: 365 });
    expect(r.purged).toBe(1);
    expect(r.compressed).toBe(1);

    const agedRow = await db.selectFrom("episodes").select("body").where("id", "=", aged.id).executeTakeFirstOrThrow();
    expect(agedRow.body).toBeNull();
    const ancientRow = await db.selectFrom("episodes").select("id").where("id", "=", ancient.id).executeTakeFirst();
    expect(ancientRow).toBeUndefined();
    const keptRow = await db.selectFrom("episodes").select("body").where("id", "=", kept.id).executeTakeFirstOrThrow();
    expect(keptRow.body).toBe("keep raw forever");
  });
});

describe("forgetEpisode", () => {
  it("purges an episode and everything derived from it, including the artifact", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mnemo-forget-"));
    const store = createArtifactStore({ LOCAL_STORAGE_DIR: dir });
    await store.init();
    const key = "raw/note.txt";
    await store.putArtifact(key, Buffer.from("secret"), "text/plain");

    const source = await createSource(db, { userId, kind: "test", displayName: "t" });
    const ep = await insertEpisode(db, { userId, occurredAt: new Date(), sourceId: source.id, externalId: "f1", kind: "note", artifactUri: key });
    const subject = await upsertEntity(db, { userId, type: "person", canonicalName: "Nina" });
    await insertFact(db, { userId, subjectId: subject.id, statement: "Nina said hi.", sourceEpisode: ep.id, sourceId: source.id });
    await insertEdge(db, { userId, srcId: subject.id, dstId: ep.id, rel: "mentioned_in" });
    await createOpenLoop(db, { userId, description: "call Nina", direction: "i_owe", sourceEpisode: ep.id });

    const r = await forgetEpisode({ db, store }, userId, ep.id);
    expect(r).toMatchObject({ episode: 1, facts: 1, edges: 1, openLoops: 1, artifactDeleted: true });

    const gone = await db.selectFrom("episodes").select("id").where("id", "=", ep.id).executeTakeFirst();
    expect(gone).toBeUndefined();
    expect(await db.selectFrom("facts").selectAll().where("source_episode", "=", ep.id).execute()).toHaveLength(0);
    await expect(store.getArtifact(key)).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });
});
