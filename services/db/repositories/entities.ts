import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { EntitiesTable } from "../types.js";
import { toVector } from "../vector.js";

export type Entity = Selectable<EntitiesTable>;

export interface UpsertEntityInput {
  type: string;
  canonicalName: string;
  aliases?: string[];
  attrs?: Record<string, unknown>;
  closeness?: number | null;
  embedding?: number[] | null;
}

/**
 * Upsert an entity with alias-merge logic. If an incoming name/alias matches an
 * existing entity of the same type (by canonical_name or aliases overlap), merge
 * into it (union aliases, shallow-merge attrs, refresh closeness/embedding when
 * provided) rather than creating a duplicate. Otherwise insert a new entity.
 *
 * Runs in a transaction so concurrent callers don't race a duplicate in.
 */
export async function upsertEntity(
  db: Db,
  input: UpsertEntityInput,
): Promise<Entity> {
  const names = Array.from(
    new Set([input.canonicalName, ...(input.aliases ?? [])]),
  );

  return db.transaction().execute(async (trx) => {
    const found = await sql<Entity>`
      SELECT *
      FROM entities
      WHERE type = ${input.type}
        AND (canonical_name = ANY(${names}) OR aliases && ${names})
      ORDER BY created_at ASC
      LIMIT 1
    `.execute(trx);
    const existing = found.rows[0];

    if (existing) {
      // Union aliases (excluding the canonical name itself) and merge attrs.
      const mergedAliases = Array.from(
        new Set([...existing.aliases, ...names]),
      ).filter((a) => a !== existing.canonical_name);
      const mergedAttrs = { ...existing.attrs, ...(input.attrs ?? {}) };

      return trx
        .updateTable("entities")
        .set({
          aliases: mergedAliases,
          attrs: mergedAttrs,
          closeness: input.closeness ?? existing.closeness,
          embedding:
            input.embedding != null ? toVector(input.embedding) : existing.embedding,
          updated_at: new Date(),
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return trx
      .insertInto("entities")
      .values({
        type: input.type,
        canonical_name: input.canonicalName,
        aliases: input.aliases ?? [],
        attrs: input.attrs ?? {},
        closeness: input.closeness ?? null,
        embedding: input.embedding != null ? toVector(input.embedding) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
