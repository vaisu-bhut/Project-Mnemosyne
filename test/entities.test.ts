import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { upsertEntity } from "../services/db/index.js";
import { testDb, truncateAll } from "./helpers.js";

const db = testDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.destroy());

describe("upsertEntity (alias-merge)", () => {
  it("creates a new entity when nothing matches", async () => {
    const e = await upsertEntity(db, {
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
      type: "person",
      canonicalName: "Sara Lin",
      aliases: ["Sara"],
      attrs: { hometown: "Boston" },
    });

    // Incoming canonical name matches the existing alias "Sara".
    const merged = await upsertEntity(db, {
      type: "person",
      canonicalName: "Sara",
      aliases: ["S. Lin"],
      attrs: { job: "architect" },
    });

    expect(merged.id).toBe(first.id); // same row, not a duplicate
    expect(merged.aliases.sort()).toEqual(["S. Lin", "Sara"].sort());
    expect(merged.attrs).toMatchObject({ hometown: "Boston", job: "architect" });
  });

  it("matches on canonical_name as well as aliases", async () => {
    const first = await upsertEntity(db, { type: "org", canonicalName: "Acme" });
    const again = await upsertEntity(db, {
      type: "org",
      canonicalName: "Acme",
      aliases: ["Acme Corp"],
    });
    expect(again.id).toBe(first.id);
    expect(again.aliases).toContain("Acme Corp");
  });

  it("does not merge across different types", async () => {
    const person = await upsertEntity(db, { type: "person", canonicalName: "Mercury" });
    const planet = await upsertEntity(db, { type: "place", canonicalName: "Mercury" });
    expect(planet.id).not.toBe(person.id);
  });
});
