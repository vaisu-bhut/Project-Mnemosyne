import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { createSource, insertEpisode } from "../services/db/index.js";
import { testDb, truncateAll } from "./helpers.js";

const db = testDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.destroy());

async function aSource() {
  return createSource(db, { kind: "gmail", displayName: "Gmail" });
}

describe("insertEpisode (partitioning + dedup)", () => {
  it("inserts an episode into the right monthly partition", async () => {
    const src = await aSource();
    const ep = await insertEpisode(db, {
      occurredAt: new Date(),
      sourceId: src.id,
      externalId: "msg-1",
      kind: "email",
      title: "Hello",
    });
    expect(ep.id).toBeTruthy();
    expect(ep.kind).toBe("email");
  });

  it("is idempotent on (source_id, external_id, occurred_at)", async () => {
    const src = await aSource();
    const occurredAt = new Date("2026-05-15T12:00:00Z");
    const first = await insertEpisode(db, {
      occurredAt,
      sourceId: src.id,
      externalId: "dup-1",
      kind: "email",
      title: "v1",
    });
    const second = await insertEpisode(db, {
      occurredAt,
      sourceId: src.id,
      externalId: "dup-1",
      kind: "email",
      title: "v2 (ignored)",
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("v1"); // existing row returned, not overwritten

    const { count } = await db
      .selectFrom("episodes")
      .select(sql<number>`count(*)::int`.as("count"))
      .where("external_id", "=", "dup-1")
      .executeTakeFirstOrThrow();
    expect(count).toBe(1);
  });

  it("always inserts when external_id is null (NULLs are distinct)", async () => {
    const src = await aSource();
    const occurredAt = new Date("2026-05-16T09:00:00Z");
    const a = await insertEpisode(db, { occurredAt, sourceId: src.id, kind: "note" });
    const b = await insertEpisode(db, { occurredAt, sourceId: src.id, kind: "note" });
    expect(b.id).not.toBe(a.id);
  });
});
