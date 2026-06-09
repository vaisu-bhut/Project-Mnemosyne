import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSource, upsertEntity } from "../db/index.js";
import { createEmbedder, createQueryEmbedder } from "../embeddings/index.js";
import { createGenerator } from "../llm/index.js";
import { recordEpisode, recordFact } from "../memory/encode.js";
import { ask } from "../memory/retrieve.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig);
const queryEmbedder = createQueryEmbedder(devConfig);
const generator = createGenerator(devConfig); // dev: not available → returns cited facts
const Q = "QSCOPE";

let userId: string;
let alice: string;
let bob: string;
let srcId: string;

beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
  alice = (await upsertEntity(db, { userId, type: "person", canonicalName: "Alice" })).id;
  bob = (await upsertEntity(db, { userId, type: "person", canonicalName: "Bob" })).id;
  srcId = (await createSource(db, { userId, kind: "test", displayName: "S", scope: "personal" })).id;
  const ep = await recordEpisode(
    { db, embedder },
    { userId, occurredAt: new Date(), sourceId: srcId, externalId: "e1", kind: "note", body: "b", embedText: Q },
  );
  await recordFact(
    { db, embedder },
    { userId, subjectId: alice, statement: "Alice likes tea", sourceEpisode: ep.id, sourceId: srcId, embedText: Q },
  );
  await recordFact(
    { db, embedder },
    { userId, subjectId: bob, statement: "Bob likes coffee", sourceEpisode: ep.id, sourceId: srcId, embedText: Q },
  );
});
afterAll(() => db.destroy());

describe("ask() page-context scope", () => {
  it("unscoped ask can retrieve facts about both entities", async () => {
    const r = await ask({ db, embedder: queryEmbedder, generator }, userId, Q, 10);
    const statements = r.used.facts.map((f) => f.statement);
    expect(statements).toContain("Alice likes tea");
    expect(statements).toContain("Bob likes coffee");
  });

  it("entity-scoped ask retrieves only that entity's facts", async () => {
    const r = await ask({ db, embedder: queryEmbedder, generator }, userId, Q, 10, {}, {
      scope: { entityId: alice },
    });
    const statements = r.used.facts.map((f) => f.statement);
    expect(statements).toContain("Alice likes tea");
    expect(statements).not.toContain("Bob likes coffee");
  });
});
