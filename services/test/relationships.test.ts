import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSource, insertEpisode } from "../db/index.js";
import { createEmbedder } from "../embeddings/index.js";
import { createExtractor, type ExtractionResult } from "../extract/index.js";
import { runExtraction } from "../ingest/pipeline.js";
import type { TextGenerator } from "../llm/index.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig);

let userId: string;
beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

/** A generator that returns a fixed extraction (the Sarah/Jane/Kane note). */
function stubGenerator(result: ExtractionResult): TextGenerator {
  return {
    available: true,
    async generateText() {
      return "";
    },
    async generateJson<T>() {
      return result as unknown as T;
    },
  };
}

describe("multi-person relationship extraction", () => {
  it("creates a typed relationship edge connecting the people in a note", async () => {
    const gen = stubGenerator({
      entities: [
        { name: "Sarah", type: "person" },
        { name: "Jane", type: "person" },
        { name: "Kane", type: "person" },
      ],
      facts: [],
      openLoops: [],
      relationships: [{ from: "Kane", to: "Sarah", relation: "realtor", detail: "Sarah's realtor" }],
    });
    const extractor = createExtractor({ LLM_PROVIDER: "qwen" }, gen);
    const source = await createSource(db, { userId, kind: "voice", displayName: "Voice notes" });
    const ep = await insertEpisode(db, {
      userId,
      occurredAt: new Date(),
      sourceId: source.id,
      externalId: "vn1",
      kind: "voice_note",
      title: null,
      body: "Sarah is meeting Jane about the house listing, bringing Kane, her realtor.",
    });

    const summary = await runExtraction({ db, embedder, extractor }, ep.id);
    expect(summary.entities).toBe(3);
    expect(summary.relationships).toBe(1);

    // The typed person↔person edge carries the role + detail.
    const rels = await db
      .selectFrom("edges as e")
      .innerJoin("entities as f", "f.id", "e.src_id")
      .innerJoin("entities as t", "t.id", "e.dst_id")
      .select(["f.canonical_name as from", "t.canonical_name as to", "e.props as props"])
      .where("e.user_id", "=", userId)
      .where("e.rel", "=", "relationship")
      .execute();
    expect(rels).toHaveLength(1);
    expect(rels[0]!.from).toBe("Kane");
    expect(rels[0]!.to).toBe("Sarah");
    expect((rels[0]!.props as { role?: string }).role).toBe("realtor");

    // All three are linked to the episode (so each surfaces it in their context).
    const mentions = await db
      .selectFrom("edges")
      .select("src_id")
      .where("user_id", "=", userId)
      .where("rel", "=", "mentioned_in")
      .where("dst_id", "=", ep.id)
      .execute();
    expect(mentions).toHaveLength(3);
  });
});
