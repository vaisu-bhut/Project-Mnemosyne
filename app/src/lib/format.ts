/** Format an ISO timestamp as a short local date (empty string if invalid). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A 0–1 value as a whole percentage, e.g. 0.82 -> "82%". */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
