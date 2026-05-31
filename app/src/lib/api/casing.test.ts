import { describe, expect, it } from "vitest";
import { camelize } from "./casing";

describe("camelize", () => {
  it("converts snake_case keys to camelCase", () => {
    expect(camelize({ user_id: "u", display_name: "n" })).toEqual({
      userId: "u",
      displayName: "n",
    });
  });

  it("recurses into nested objects and arrays", () => {
    expect(
      camelize({ open_threads: [{ source_episode: "e", due_at: null }] }),
    ).toEqual({ openThreads: [{ sourceEpisode: "e", dueAt: null }] });
  });

  it("preserves primitive values and null", () => {
    expect(camelize({ sensitive: false, created_at: "2026-01-01", x: null })).toEqual({
      sensitive: false,
      createdAt: "2026-01-01",
      x: null,
    });
  });

  it("camelizes a top-level array of rows", () => {
    expect(camelize([{ entity_id: "a" }, { entity_id: "b" }])).toEqual([
      { entityId: "a" },
      { entityId: "b" },
    ]);
  });
});
