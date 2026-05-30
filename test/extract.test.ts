import { describe, expect, it } from "vitest";
import { createExtractor } from "../services/extract/index.js";
import { createGenerator } from "../services/llm/index.js";
import { devConfig } from "./helpers.js";

const extractor = createExtractor(devConfig, createGenerator(devConfig));

describe("dev extractor (heuristic)", () => {
  it("pulls proper-noun entities and a fact per entity", async () => {
    const r = await extractor.extract({
      title: "Dinner",
      body: "Had dinner with Sara Lin at Toscano. Marcus joined late.",
    });
    const names = r.entities.map((e) => e.name);
    expect(names).toContain("Sara Lin");
    expect(names).toContain("Marcus");
    expect(names).not.toContain("Had"); // sentence-initial stopword filtered
    expect(r.facts).toHaveLength(r.entities.length);
    expect(r.facts.every((f) => f.predicate === "mentioned")).toBe(true);
  });

  it("detects i_owe and they_owe open loops", async () => {
    const r = await extractor.extract({
      title: null,
      body: "I'll send Marcus the deck tomorrow. You owe me the book back.",
    });
    const dirs = r.openLoops.map((l) => l.direction);
    expect(dirs).toContain("i_owe");
    expect(dirs).toContain("they_owe");
  });
});
