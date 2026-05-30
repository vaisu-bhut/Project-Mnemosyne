import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSource,
  insertEpisode,
  searchEntitiesByVector,
  searchEpisodesByVector,
  upsertEntity,
} from "../services/db/index.js";
import { embedding, testDb, truncateAll } from "./helpers.js";

const db = testDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.destroy());

describe("vector KNN search (cosine)", () => {
  it("returns the nearest entity first", async () => {
    await upsertEntity(db, { type: "topic", canonicalName: "A", embedding: embedding(0) });
    await upsertEntity(db, { type: "topic", canonicalName: "B", embedding: embedding(1) });
    await upsertEntity(db, { type: "topic", canonicalName: "C", embedding: embedding(2) });

    const hits = await searchEntitiesByVector(db, embedding(1), 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.canonical_name).toBe("B");
    expect(hits[0]?.distance).toBeLessThan(hits[1]!.distance);
  });

  it("searches episodes by embedding and ignores rows without one", async () => {
    const src = await createSource(db, { kind: "notes", displayName: "Notes" });
    await insertEpisode(db, {
      occurredAt: new Date(),
      sourceId: src.id,
      kind: "note",
      title: "near",
      embedding: embedding(5),
    });
    await insertEpisode(db, {
      occurredAt: new Date(),
      sourceId: src.id,
      kind: "note",
      title: "far",
      embedding: embedding(50),
    });
    // No embedding -> must not appear in results.
    await insertEpisode(db, { occurredAt: new Date(), sourceId: src.id, kind: "note" });

    const hits = await searchEpisodesByVector(db, embedding(5), 10);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.title).toBe("near");
  });
});
