import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { createSource } from "../services/db/index.js";
import { createEmbedder } from "../services/embeddings/index.js";
import { createExtractor } from "../services/extract/index.js";
import { createGenerator } from "../services/llm/index.js";
import { createFilesystemConnector } from "../services/ingest/filesystem.js";
import { runExtraction, runIngest } from "../services/ingest/pipeline.js";
import { createArtifactStore } from "../services/storage/index.js";
import { devConfig, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig);
const extractor = createExtractor(devConfig, createGenerator(devConfig));

let notesDir: string;
let storeDir: string;

beforeAll(async () => {
  notesDir = await mkdtemp(path.join(tmpdir(), "mnemo-notes-"));
  storeDir = await mkdtemp(path.join(tmpdir(), "mnemo-store-"));
  await writeFile(
    path.join(notesDir, "dinner.md"),
    "---\ntitle: Dinner with Sara\ndate: 2026-05-10\n---\nHad dinner with Sara Lin at Toscano. Sara mentioned her dad.",
  );
  await writeFile(
    path.join(notesDir, "todo.md"),
    "# Follow ups\nI'll send Marcus the deck tomorrow.",
  );
});

beforeEach(() => truncateAll(db));
afterAll(async () => {
  await db.destroy();
  await rm(notesDir, { recursive: true, force: true });
  await rm(storeDir, { recursive: true, force: true });
});

describe("ingest + extraction pipeline", () => {
  it("ingests notes into embedded episodes, then extracts with provenance", async () => {
    const store = createArtifactStore({ LOCAL_STORAGE_DIR: storeDir });
    const source = await createSource(db, {
      kind: "filesystem",
      displayName: "Journal",
      config: { dir: notesDir },
    });
    const connector = createFilesystemConnector({ dir: notesDir });

    const summary = await runIngest({ db, store, embedder }, source, connector);
    expect(summary.ingested).toBe(2);
    expect(summary.episodeIds).toHaveLength(2);

    // Episodes were embedded.
    const { embedded } = await db
      .selectFrom("episodes")
      .select(sql<number>`count(*) FILTER (WHERE embedding IS NOT NULL)::int`.as("embedded"))
      .executeTakeFirstOrThrow();
    expect(embedded).toBe(2);

    // Extract each episode.
    let totalFacts = 0;
    let totalLoops = 0;
    for (const episodeId of summary.episodeIds) {
      const r = await runExtraction({ db, embedder, extractor }, episodeId);
      totalFacts += r.facts;
      totalLoops += r.openLoops;
    }
    expect(totalFacts).toBeGreaterThan(0);
    expect(totalLoops).toBeGreaterThan(0); // "I'll send..." -> i_owe

    // Every fact carries provenance pointing back into this source.
    const facts = await db
      .selectFrom("facts")
      .select(["source_episode", "source_id"])
      .execute();
    expect(facts.length).toBe(totalFacts);
    expect(facts.every((f) => f.source_id === source.id)).toBe(true);
    expect(facts.every((f) => summary.episodeIds.includes(f.source_episode))).toBe(true);

    // Entities are linked to their episode via mentioned_in edges.
    const { edges } = await db
      .selectFrom("edges")
      .select(sql<number>`count(*)::int`.as("edges"))
      .where("rel", "=", "mentioned_in")
      .executeTakeFirstOrThrow();
    expect(edges).toBeGreaterThan(0);
  });
});
