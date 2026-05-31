import { describe, expect, it } from "vitest";
import { parseCitations } from "./citations";

describe("parseCitations", () => {
  it("returns a single text segment when there are no citations", () => {
    expect(parseCitations("just text")).toEqual([{ type: "text", value: "just text" }]);
  });

  it("splits a citation out of surrounding text", () => {
    expect(parseCitations("dinner [episode:abc] yes")).toEqual([
      { type: "text", value: "dinner " },
      { type: "cite", episodeId: "abc" },
      { type: "text", value: " yes" },
    ]);
  });

  it("handles adjacent citations", () => {
    expect(parseCitations("[episode:a][episode:b]")).toEqual([
      { type: "cite", episodeId: "a" },
      { type: "cite", episodeId: "b" },
    ]);
  });

  it("trims whitespace inside the marker", () => {
    expect(parseCitations("x [episode: id-1 ]")).toEqual([
      { type: "text", value: "x " },
      { type: "cite", episodeId: "id-1" },
    ]);
  });
});
