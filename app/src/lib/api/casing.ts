/**
 * Some backend endpoints return raw DB rows in snake_case (BACKEND.md §6:
 * /sources, /open-loops, /mind, /contradictions). This normalizes keys to
 * camelCase so the UI deals in one convention. Date-like strings are left as-is.
 */

type Json = unknown;

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function camelize<T = Json>(value: Json): T {
  if (Array.isArray(value)) {
    return value.map((v) => camelize(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [key, val] of Object.entries(value as Record<string, Json>)) {
      out[toCamel(key)] = camelize(val);
    }
    return out as T;
  }
  return value as T;
}
