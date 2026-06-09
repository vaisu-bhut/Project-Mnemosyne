import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIngestRun,
  createSource,
  getLatestIngestRun,
  updateIngestRun,
} from "../db/index.js";
import { createEmbedder } from "../embeddings/index.js";
import { runIngest, type IngestProgress } from "../ingest/pipeline.js";
import type { Connector } from "../ingest/connector.js";
import { createArtifactStore } from "../storage/index.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig);
const store = createArtifactStore({ LOCAL_STORAGE_DIR: "./.data/test-ingest-runs" });

let userId: string;
beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

describe("ingest_runs repository", () => {
  it("creates, patches counts/sample, and returns the latest run", async () => {
    const source = await createSource(db, { userId, kind: "filesystem", displayName: "J" });
    const run = await createIngestRun(db, userId, source.id);
    expect(run.status).toBe("queued");
    expect(run.ingested).toBe(0);
    expect(run.items).toEqual([]);

    await updateIngestRun(db, run.id, {
      status: "running",
      ingested: 1,
      total: 3,
      items: [{ title: "Email from Sara", kind: "email" }],
    });
    await updateIngestRun(db, run.id, {
      status: "done",
      ingested: 3,
      finishedAt: new Date(),
    });

    const latest = await getLatestIngestRun(db, userId, source.id);
    expect(latest?.status).toBe("done");
    expect(latest?.ingested).toBe(3);
    expect(latest?.total).toBe(3);
    expect(latest?.items).toEqual([{ title: "Email from Sara", kind: "email" }]);
    expect(latest?.finished_at).not.toBeNull();
  });

  it("scopes the latest run to the owner", async () => {
    const other = await seedUser(db);
    const source = await createSource(db, { userId, kind: "filesystem", displayName: "J" });
    await createIngestRun(db, userId, source.id);
    expect(await getLatestIngestRun(db, other, source.id)).toBeUndefined();
  });
});

describe("runIngest onProgress", () => {
  it("reports incremental progress with the last item for each episode", async () => {
    const source = await createSource(db, { userId, kind: "gmail", displayName: "Gmail" });
    const stub: Connector = {
      name: "stub",
      async pull() {
        return {
          items: [1, 2, 3].map((n) => ({
            externalId: `m${n}`,
            occurredAt: new Date(),
            kind: "email",
            title: `Message ${n}`,
            body: "body",
            raw: Buffer.from("{}"),
            contentType: "application/json",
          })),
        };
      },
    };

    const progress: IngestProgress[] = [];
    const summary = await runIngest({ db, store, embedder }, source, stub, {
      onProgress: (p) => {
        progress.push(p);
      },
    });

    expect(summary.ingested).toBe(3);
    expect(progress).toHaveLength(3);
    expect(progress.map((p) => p.ingested)).toEqual([1, 2, 3]);
    expect(progress.every((p) => p.total === 3)).toBe(true);
    expect(progress.map((p) => p.lastItem.title)).toEqual([
      "Message 1",
      "Message 2",
      "Message 3",
    ]);
  });
});
