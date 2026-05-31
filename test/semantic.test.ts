import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSource, upsertEntity, type Source } from "../services/db/index.js";
import { createEmbedder, createQueryEmbedder } from "../services/embeddings/index.js";
import type { TextGenerator } from "../services/llm/index.js";
import { recordEntity, recordEpisode, recordFact } from "../services/memory/encode.js";
import { detectContradictions, resolveEntities } from "../services/consolidate/index.js";
import { route } from "../services/agents/index.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig);
const queryEmbedder = createQueryEmbedder(devConfig);
const SAME_VEC = "SHARED-EMBED-TEXT"; // dev embedder -> identical vectors -> candidates

/** A canned LLM: generateJson returns a fixed object (per test). */
function stub(json: unknown): TextGenerator {
  return {
    available: true,
    async generateText() {
      return "";
    },
    async generateJson<T>() {
      return json as T;
    },
  };
}

let userId: string;
beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

describe("semantic alias resolution", () => {
  it("merges token-disjoint names the LLM confirms are the same person", async () => {
    // "Mike" and "Michael Chen" share no tokens -> lexical can't merge them.
    await recordEntity({ db, embedder }, { userId, type: "person", canonicalName: "Mike", embedText: SAME_VEC });
    await recordEntity({ db, embedder }, { userId, type: "person", canonicalName: "Michael Chen", embedText: SAME_VEC });

    const gen = stub({ decisions: [{ i: 0, same: true, confidence: 0.95 }] });
    const r = await resolveEntities(db, userId, { generator: gen });
    expect(r.merged).toBe(1);

    const people = await db.selectFrom("entities").selectAll().where("type", "=", "person").execute();
    expect(people).toHaveLength(1);
    expect(people[0]!.canonical_name).toBe("Michael Chen"); // richer record survives
    expect(people[0]!.aliases).toContain("Mike");
  });

  it("does not merge when the LLM says they differ", async () => {
    await recordEntity({ db, embedder }, { userId, type: "person", canonicalName: "John Smith", embedText: SAME_VEC });
    await recordEntity({ db, embedder }, { userId, type: "person", canonicalName: "John Doe", embedText: SAME_VEC });

    const gen = stub({ decisions: [{ i: 0, same: false, confidence: 0.9 }] });
    const r = await resolveEntities(db, userId, { generator: gen });
    expect(r.merged).toBe(0);
    expect(await db.selectFrom("entities").selectAll().where("type", "=", "person").execute()).toHaveLength(2);
  });
});

describe("semantic contradiction (NLI)", () => {
  async function seedFacts(): Promise<{ source: Source; aId: string; bId: string }> {
    const source = await createSource(db, { userId, kind: "test", displayName: "t" });
    const ep = await recordEpisode({ db, embedder }, { userId, occurredAt: new Date(), sourceId: source.id, externalId: "e", kind: "note", body: "b" });
    const subject = await upsertEntity(db, { userId, type: "person", canonicalName: "Alex" });
    const common = { userId, subjectId: subject.id, sourceEpisode: ep.id, sourceId: source.id };
    const a = await recordFact({ db, embedder }, { ...common, statement: "Alex is a teacher.", predicate: "role", embedText: SAME_VEC });
    const b = await recordFact({ db, embedder }, { ...common, statement: "Alex is a surgeon.", predicate: "job", embedText: SAME_VEC });
    return { source, aId: a.id, bId: b.id };
  }

  it("links facts the LLM judges as contradictory (across different predicates)", async () => {
    await seedFacts();
    const gen = stub({ relations: [{ i: 0, relation: "contradicts" }] });
    const r = await detectContradictions(db, userId, { generator: gen });
    expect(r.linked).toBe(1);

    const linked = await db.selectFrom("facts").selectAll().where("contradicts", "is not", null).execute();
    expect(linked).toHaveLength(1);
  });

  it("does not link when the LLM judges them unrelated/duplicate", async () => {
    await seedFacts();
    const gen = stub({ relations: [{ i: 0, relation: "unrelated" }] });
    const r = await detectContradictions(db, userId, { generator: gen });
    expect(r.linked).toBe(0);
    expect(await db.selectFrom("facts").selectAll().where("contradicts", "is not", null).execute()).toHaveLength(0);
  });
});

describe("semantic Conductor routing", () => {
  it("routes by LLM intent without trigger keywords", async () => {
    const gen = stub({ intent: "people", target: null });
    const res = await route({ db, queryEmbedder, generator: gen }, userId, "am I drifting from anyone?", {}, true);
    expect(res.intent).toBe("people");
    expect(res.via).toBe("people");
  });

  it("uses the LLM-extracted target for briefings", async () => {
    await upsertEntity(db, { userId, type: "person", canonicalName: "Sara Lin" });
    const gen = stub({ intent: "briefing", target: "Sara Lin" });
    const res = await route({ db, queryEmbedder, generator: gen }, userId, "what should I know before my 1:1", {}, true);
    expect(res.intent).toBe("briefing");
    expect(res.via).toBe("briefer");
    expect((res.result as { name: string }).name).toBe("Sara Lin");
  });
});
