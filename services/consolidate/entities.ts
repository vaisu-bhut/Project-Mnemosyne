import type { Db } from "../db/index.js";
import { isTokenSubset, nameTokens } from "./util.js";

/**
 * Merge the `dupe` entity into `survivor`: union aliases, shallow-merge attrs,
 * repoint every reference (facts.subject_id/object_id, edges.src/dst,
 * open_loops.counterparty), then delete the dupe. Runs in one transaction.
 */
export async function mergeEntities(
  db: Db,
  survivorId: string,
  dupeId: string,
): Promise<void> {
  if (survivorId === dupeId) return;
  await db.transaction().execute(async (trx) => {
    const survivor = await trx
      .selectFrom("entities")
      .selectAll()
      .where("id", "=", survivorId)
      .executeTakeFirstOrThrow();
    const dupe = await trx
      .selectFrom("entities")
      .selectAll()
      .where("id", "=", dupeId)
      .executeTakeFirstOrThrow();

    const aliases = Array.from(
      new Set([...survivor.aliases, ...dupe.aliases, dupe.canonical_name]),
    ).filter((a) => a !== survivor.canonical_name);

    await trx
      .updateTable("entities")
      .set({
        aliases,
        attrs: { ...dupe.attrs, ...survivor.attrs },
        closeness: survivor.closeness ?? dupe.closeness,
        updated_at: new Date(),
      })
      .where("id", "=", survivorId)
      .execute();

    await trx.updateTable("facts").set({ subject_id: survivorId }).where("subject_id", "=", dupeId).execute();
    await trx.updateTable("facts").set({ object_id: survivorId }).where("object_id", "=", dupeId).execute();
    await trx.updateTable("edges").set({ src_id: survivorId }).where("src_id", "=", dupeId).execute();
    await trx.updateTable("edges").set({ dst_id: survivorId }).where("dst_id", "=", dupeId).execute();
    await trx.updateTable("open_loops").set({ counterparty: survivorId }).where("counterparty", "=", dupeId).execute();

    await trx.deleteFrom("entities").where("id", "=", dupeId).execute();
  });
}

export interface ResolveEntitiesResult {
  merged: number;
}

/**
 * Resolve entity aliases. Within a type, if one entity's name tokens are a
 * strict subset of another's ("Sara" ⊂ "Sara Lin"), or they share an exact
 * name/alias, merge the less-specific into the more-specific (tie-break: older
 * survives). Repeats until no more merges.
 *
 * NOTE: heuristic — token-subset can over-merge ambiguous first names
 * ("John" with two different "John X"). Phase-later: use embeddings/LLM to
 * disambiguate. Conservative enough for now; merges are logged by count.
 */
export async function resolveEntities(
  db: Db,
  userId: string,
): Promise<ResolveEntitiesResult> {
  let merged = 0;

  for (;;) {
    const entities = await db
      .selectFrom("entities")
      .select(["id", "type", "canonical_name", "aliases", "created_at"])
      .where("user_id", "=", userId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();

    const byType = new Map<string, typeof entities>();
    for (const e of entities) {
      const list = byType.get(e.type) ?? [];
      list.push(e);
      byType.set(e.type, list);
    }

    let pair: { survivor: string; dupe: string } | undefined;
    outer: for (const list of byType.values()) {
      for (const a of list) {
        const aNames = new Set([a.canonical_name, ...a.aliases].map((s) => s.toLowerCase()));
        const aTok = nameTokens([a.canonical_name, ...a.aliases].join(" "));
        for (const b of list) {
          if (a.id === b.id) continue;
          const bNames = new Set([b.canonical_name, ...b.aliases].map((s) => s.toLowerCase()));
          const bTok = nameTokens([b.canonical_name, ...b.aliases].join(" "));

          const shared = [...aNames].some((n) => bNames.has(n));
          // a is less specific than b -> merge a into b.
          if (isTokenSubset(aTok, bTok) || (shared && aTok.size < bTok.size)) {
            pair = { survivor: b.id, dupe: a.id };
            break outer;
          }
        }
      }
    }

    if (!pair) break;
    await mergeEntities(db, pair.survivor, pair.dupe);
    merged++;
  }

  return { merged };
}
