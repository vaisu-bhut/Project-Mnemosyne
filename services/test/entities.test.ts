import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { upsertEntity } from "../db/index.js";
import { seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
let userId: string;

beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

describe("upsertEntity (alias-merge)", () => {
  it("creates a new entity when nothing matches", async () => {
    const e = await upsertEntity(db, {
      userId,
      type: "person",
      canonicalName: "Sara Lin",
      aliases: ["Sara"],
      attrs: { hometown: "Boston" },
    });
    expect(e.canonical_name).toBe("Sara Lin");
    expect(e.aliases.sort()).toEqual(["Sara"]);
    expect(e.attrs).toMatchObject({ hometown: "Boston" });
  });

  it("merges into an existing entity when an alias overlaps", async () => {
    const first = await upsertEntity(db, {
      userId,
      type: "person",
      canonicalName: "Sara Lin",
      aliases: ["Sara"],
      attrs: { hometown: "Boston" },
    });

    const merged = await upsertEntity(db, {
      userId,
      type: "person",
      canonicalName: "Sara",
      aliases: ["S. Lin"],
      attrs: { job: "architect" },
    });

    expect(merged.id).toBe(first.id);
    expect(merged.aliases.sort()).toEqual(["S. Lin", "Sara"].sort());
    expect(merged.attrs).toMatchObject({ hometown: "Boston", job: "architect" });
  });

  it("matches on canonical_name as well as aliases", async () => {
    const first = await upsertEntity(db, { userId, type: "org", canonicalName: "Acme" });
    const again = await upsertEntity(db, {
      userId,
      type: "org",
      canonicalName: "Acme",
      aliases: ["Acme Corp"],
    });
    expect(again.id).toBe(first.id);
    expect(again.aliases).toContain("Acme Corp");
  });

  it("does not merge across different types", async () => {
    const person = await upsertEntity(db, { userId, type: "person", canonicalName: "Mercury" });
    const planet = await upsertEntity(db, { userId, type: "place", canonicalName: "Mercury" });
    expect(planet.id).not.toBe(person.id);
  });

  it("does not merge across different users", async () => {
    const other = await seedUser(db);
    const a = await upsertEntity(db, { userId, type: "person", canonicalName: "Sara" });
    const b = await upsertEntity(db, { userId: other, type: "person", canonicalName: "Sara" });
    expect(b.id).not.toBe(a.id);
  });
});
