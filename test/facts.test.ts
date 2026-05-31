import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSource,
  insertEpisode,
  insertFact,
  reinforceFact,
  upsertEntity,
} from "../services/db/index.js";
import { seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
let userId: string;

beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

async function fixtures() {
  const source = await createSource(db, { userId, kind: "gmail", displayName: "Gmail" });
  const subject = await upsertEntity(db, { userId, type: "person", canonicalName: "Sara" });
  const episode = await insertEpisode(db, {
    userId,
    occurredAt: new Date(),
    sourceId: source.id,
    externalId: "ep-1",
    kind: "email",
  });
  return { source, subject, episode };
}

describe("insertFact (mandatory provenance)", () => {
  it("rejects a fact with missing provenance", async () => {
    const { subject } = await fixtures();
    await expect(
      // @ts-expect-error — deliberately omitting required provenance
      insertFact(db, { userId, subjectId: subject.id, statement: "no source" }),
    ).rejects.toThrow(/provenance is mandatory/i);
  });

  it("inserts a fact with provenance and defaults reinforced=1", async () => {
    const { source, subject, episode } = await fixtures();
    const fact = await insertFact(db, {
      userId,
      subjectId: subject.id,
      statement: "Sara's dad has heart issues.",
      predicate: "health",
      sourceEpisode: episode.id,
      sourceId: source.id,
    });
    expect(fact.reinforced).toBe(1);
    expect(fact.status).toBe("active");
    expect(fact.confidence).toBeCloseTo(0.5);
    expect(fact.source_episode).toBe(episode.id);
  });

  it("reinforceFact bumps the counter and stamps last_confirmed", async () => {
    const { source, subject, episode } = await fixtures();
    const fact = await insertFact(db, {
      userId,
      subjectId: subject.id,
      statement: "Sara runs marathons.",
      sourceEpisode: episode.id,
      sourceId: source.id,
    });
    expect(fact.last_confirmed).toBeNull();

    const reinforced = await reinforceFact(db, fact.id);
    expect(reinforced.reinforced).toBe(2);
    expect(reinforced.last_confirmed).toBeInstanceOf(Date);
  });
});
