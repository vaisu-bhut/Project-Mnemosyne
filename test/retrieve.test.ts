import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSource } from "../services/db/index.js";
import { createEmbedder, createQueryEmbedder } from "../services/embeddings/index.js";
import { createGenerator } from "../services/llm/index.js";
import { recordEntity, recordEpisode, recordFact } from "../services/memory/encode.js";
import { ask, searchMemory } from "../services/memory/retrieve.js";
import { devConfig, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig); // documents
const queryEmbedder = createQueryEmbedder(devConfig); // queries (dev: identical)
const generator = createGenerator(devConfig);

beforeEach(() => truncateAll(db));
afterAll(() => db.destroy());

// The dev embedder hashes whole strings, so an exact-match embedText is the
// deterministic way to control nearest-neighbour ordering in tests.
const QUERY = "QTEXT-iceland-trip";

async function seed() {
  const source = await createSource(db, { kind: "test", displayName: "t" });
  const target = await recordEpisode(
    { db, embedder },
    { occurredAt: new Date(), sourceId: source.id, externalId: "t1", kind: "note", title: "Target", body: "iceland", embedText: QUERY },
  );
  await recordEpisode(
    { db, embedder },
    { occurredAt: new Date(), sourceId: source.id, externalId: "t2", kind: "note", title: "Other", body: "taxes", embedText: "UNRELATED-OTHER" },
  );
  const subject = await recordEntity({ db, embedder }, { type: "topic", canonicalName: "Iceland" });
  const fact = await recordFact(
    { db, embedder },
    { subjectId: subject.id, statement: "The Iceland trip was great.", sourceEpisode: target.id, sourceId: source.id, embedText: QUERY },
  );
  return { source, target, fact };
}

describe("searchMemory + ask (cited retrieval)", () => {
  it("ranks the matching episode and fact first, with citations", async () => {
    const { target, fact } = await seed();
    const res = await searchMemory({ db, embedder: queryEmbedder }, QUERY, 5);

    expect(res.episodes[0]?.id).toBe(target.id);
    expect(res.episodes[0]?.citation.episodeId).toBe(target.id);
    expect(res.facts[0]?.id).toBe(fact.id);
    expect(res.facts[0]?.citation.episodeId).toBe(target.id);
  });

  it("ask (dev) answers strictly from retrieved facts and cites them", async () => {
    const { target } = await seed();
    const answer = await ask({ db, embedder: queryEmbedder, generator }, QUERY, 5);
    expect(answer.answer).toContain(`episode:${target.id}`);
    expect(answer.citations.length).toBeGreaterThan(0);
  });
});
