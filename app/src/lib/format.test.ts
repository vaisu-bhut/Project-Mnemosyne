import { describe, expect, it } from "vitest";
import { formatDate, pct } from "./format";

describe("pct", () => {
  it("renders a 0-1 value as a whole percentage", () => {
    expect(pct(0.823)).toBe("82%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
  });
});

describe("formatDate", () => {
  it("returns an empty string for null/invalid input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });

  it("formats a valid ISO timestamp and includes the year", () => {
    expect(formatDate("2026-05-10T12:00:00.000Z")).toContain("2026");
  });
});
