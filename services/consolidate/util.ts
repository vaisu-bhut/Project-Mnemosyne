/** Normalize a statement for equality comparison (dedup / contradiction). */
export function normalizeStatement(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"().,;:!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercased word tokens of a name (for alias/subset matching). */
export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(Boolean),
  );
}

/** True if every token of `a` is also in `b` (a is a less-specific form of b). */
export function isTokenSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size >= b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/**
 * Token-containment overlap: |a ∩ b| / min(|a|, |b|). ~1.0 means one statement's
 * words are largely contained in the other (a paraphrase / restatement); lower
 * values mean they genuinely diverge (a candidate contradiction).
 */
export function containmentOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}
