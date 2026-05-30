/**
 * pgvector interop helpers. pgvector accepts and returns vectors as the textual
 * '[1,2,3]' form over the wire, so we convert at the edges.
 */

/** Serialize a number[] to the pgvector text literal. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/** Parse a pgvector text literal back into number[] (null-safe). */
export function parseVector(value: string | null): number[] | null {
  if (value == null) return null;
  const inner = value.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (inner === "") return [];
  return inner.split(",").map((n) => Number(n));
}
