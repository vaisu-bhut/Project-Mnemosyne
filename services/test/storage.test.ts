import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactStore, type ArtifactStore } from "../storage/index.js";

let dir: string;
let store: ArtifactStore;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mnemosyne-store-"));
  store = createArtifactStore({ LOCAL_STORAGE_DIR: dir });
  await store.init();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("local filesystem artifact store", () => {
  it("round-trips an artifact through put/get", async () => {
    const body = Buffer.from("hello memory", "utf8");
    await store.putArtifact("notes/a.txt", body, "text/plain");
    const got = await store.getArtifact("notes/a.txt");
    expect(got.equals(body)).toBe(true);
  });

  it("deletes idempotently (no throw on missing)", async () => {
    await store.putArtifact("temp.bin", Buffer.from([1, 2, 3]), "application/octet-stream");
    await store.deleteArtifact("temp.bin");
    await expect(store.getArtifact("temp.bin")).rejects.toThrow();
    await expect(store.deleteArtifact("temp.bin")).resolves.toBeUndefined();
  });

  it("refuses path traversal keys", async () => {
    await expect(
      store.putArtifact("../escape.txt", Buffer.from("x"), "text/plain"),
    ).rejects.toThrow(/path traversal/i);
  });

  it("reports reachable", async () => {
    expect(await store.reachable()).toBe(true);
  });
});
