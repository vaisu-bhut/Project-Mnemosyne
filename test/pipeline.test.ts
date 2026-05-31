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
import type { Connector } from "../services/ingest/connector.js";
import { searchMemory } from "../services/memory/retrieve.js";
import { createArtifactStore } from "../services/storage/index.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

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

let userId: string;
beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(async () => {
  await db.destroy();
  await rm(notesDir, { recursive: true, force: true });
  await rm(storeDir, { recursive: true, force: true });
});

describe("ingest + extraction pipeline", () => {
  it("ingests notes into embedded episodes, then extracts with provenance", async () => {
    const store = createArtifactStore({ LOCAL_STORAGE_DIR: storeDir });
    const source = await createSource(db, {
      userId,
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

  it("links participants from headers and persists the connector cursor", async () => {
    const store = createArtifactStore({ LOCAL_STORAGE_DIR: storeDir });
    const source = await createSource(db, { userId, kind: "gmail", displayName: "Gmail" });

    const stub: Connector = {
      name: "stub",
      async pull(opts) {
        expect(opts?.cursor ?? null).toBeNull(); // first run, no cursor yet
        return {
          cursor: "hist-1",
          items: [
            {
              externalId: "m1",
              occurredAt: new Date(),
              kind: "email",
              title: "Lunch",
              body: "From: Sara Lin <sara@x.com>\n\nLet's grab lunch.",
              raw: Buffer.from("{}"),
              contentType: "application/json",
              participants: [{ name: "Sara Lin", email: "sara@x.com", role: "from" }],
            },
          ],
        };
      },
    };

    const summary = await runIngest({ db, store, embedder }, source, stub);
    expect(summary.ingested).toBe(1);

    // A person entity was created with the email as a strong identity alias.
    const people = await db.selectFrom("entities").selectAll().where("type", "=", "person").execute();
    expect(people.some((p) => p.aliases.includes("sara@x.com"))).toBe(true);

    // The participant is linked to the episode.
    const edges = await db.selectFrom("edges").selectAll().where("rel", "=", "mentioned_in").execute();
    expect(edges.length).toBeGreaterThan(0);

    // The incremental cursor was persisted back onto the source.
    const updated = await db
      .selectFrom("sources")
      .select("config")
      .where("id", "=", source.id)
      .executeTakeFirstOrThrow();
    expect((updated.config as { cursor?: string }).cursor).toBe("hist-1");
  });

  it("encrypts the sensitive tier at rest and decrypts on authorized read", async () => {
    const store = createArtifactStore({ LOCAL_STORAGE_DIR: storeDir });
    const source = await createSource(db, { userId, kind: "gmail", displayName: "Gmail", sensitive: true });
    const secret = "SECRET-BODY-TEXT-12345";
    const stub: Connector = {
      name: "stub",
      async pull() {
        return {
          items: [
            {
              externalId: "s1",
              occurredAt: new Date(),
              kind: "email",
              title: "Secret",
              body: secret,
              raw: Buffer.from("{}"),
              contentType: "application/json",
            },
          ],
        };
      },
    };

    await runIngest({ db, store, embedder, encKey: "test-enc-key" }, source, stub);

    // At rest the body is ciphertext, flagged encrypted.
    const row = await db
      .selectFrom("episodes")
      .select(["body", "meta"])
      .where("source_id", "=", source.id)
      .executeTakeFirstOrThrow();
    expect(row.body).not.toContain(secret);
    expect((row.meta as { encrypted?: boolean }).encrypted).toBe(true);

    // With the key, retrieval decrypts; without it, the body is withheld.
    const withKey = await searchMemory({ db, embedder, encKey: "test-enc-key" }, userId, secret, 5);
    expect(withKey.episodes[0]?.snippet).toContain(secret);

    const noKey = await searchMemory({ db, embedder }, userId, secret, 5);
    expect(noKey.episodes[0]?.snippet).toBeNull();
  });
});
