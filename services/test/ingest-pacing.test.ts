import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSource } from "../db/index.js";
import { createEmbedder } from "../embeddings/index.js";
import { runIngest } from "../ingest/pipeline.js";
import { fetchWithRetry } from "../util/http.js";
import type { Connector } from "../ingest/connector.js";
import { createArtifactStore } from "../storage/index.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig);
const store = createArtifactStore({ LOCAL_STORAGE_DIR: "./.data/test-pacing" });

let userId: string;
beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

function stub(n: number): Connector {
  return {
    name: "stub",
    async pull() {
      return {
        items: Array.from({ length: n }, (_, i) => ({
          externalId: `m${i}`,
          occurredAt: new Date(),
          kind: "note",
          title: `T${i}`,
          body: "b",
          raw: Buffer.from("{}"),
          contentType: "application/json",
        })),
      };
    },
  };
}

describe("runIngest pacing", () => {
  it("delays between items (not after the last) and still persists all", async () => {
    const source = await createSource(db, { userId, kind: "test", displayName: "S" });
    const delay = 40;
    const start = Date.now();
    // 3 items → 2 inter-item delays (none after the last).
    const summary = await runIngest({ db, store, embedder }, source, stub(3), {
      itemDelayMs: delay,
    });
    const elapsed = Date.now() - start;
    expect(summary.ingested).toBe(3);
    expect(summary.episodeIds).toHaveLength(3);
    expect(elapsed).toBeGreaterThanOrEqual(2 * delay - 5);
  });
});

describe("fetchWithRetry", () => {
  it("retries on 429 then succeeds", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fake = vi.fn(async () => {
        calls++;
        return calls < 2
          ? ({ ok: false, status: 429, headers: new Headers() } as Response)
          : ({ ok: true, status: 200, headers: new Headers() } as Response);
      });
      const p = fetchWithRetry("https://x.test", undefined, { fetchImpl: fake as unknown as typeof fetch });
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns non-429 errors immediately without retrying", async () => {
    const fake = vi.fn(async () => ({ ok: false, status: 404, headers: new Headers() }) as Response);
    const res = await fetchWithRetry("https://x.test", undefined, {
      fetchImpl: fake as unknown as typeof fetch,
    });
    expect(res.status).toBe(404);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
