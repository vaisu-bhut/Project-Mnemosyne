import type { Db } from "../db/index.js";
import { containmentOverlap, nameTokens, normalizeStatement } from "./util.js";

// Statements whose words are this contained in each other are treated as
// paraphrases/restatements, not contradictions. Tuned so genuine conflicts
// ("works at Acme" vs "works at Globex", overlap 0.75) still flag, while
// re-extraction paraphrases ("had dinner at Toscano" vs "X had dinner at
// Toscano", overlap 1.0) do not.
const PARAPHRASE_OVERLAP = 0.8;

export interface ContradictionOptions {
  /** Predicates that legitimately have many values (don't flag as conflicts). */
  ignorePredicates?: string[];
}

export interface ContradictionResult {
  linked: number;
}

/**
 * Flag conflicting facts. Within a (subject, predicate) group, if multiple
 * active facts assert different statements, the earliest is treated as the
 * incumbent and each differing fact gets `contradicts` pointed at it — surfaced
 * for review rather than auto-retracted. `mentioned`-style predicates are
 * ignored (a subject can be mentioned many times without conflict).
 */
export async function detectContradictions(
  db: Db,
  userId: string,
  opts: ContradictionOptions = {},
): Promise<ContradictionResult> {
  const ignore = new Set(opts.ignorePredicates ?? ["mentioned"]);

  const facts = await db
    .selectFrom("facts")
    .select(["id", "subject_id", "predicate", "statement", "learned_at", "contradicts"])
    .where("user_id", "=", userId)
    .where("status", "=", "active")
    .where("predicate", "is not", null)
    .execute();

  const groups = new Map<string, typeof facts>();
  for (const f of facts) {
    const predicate = f.predicate!;
    if (ignore.has(predicate)) continue;
    const key = `${f.subject_id} ${predicate}`;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }

  let linked = 0;
  for (const list of groups.values()) {
    const distinct = new Set(list.map((f) => normalizeStatement(f.statement)));
    if (distinct.size < 2) continue;

    const sorted = [...list].sort(
      (a, b) => a.learned_at.getTime() - b.learned_at.getTime(),
    );
    const incumbent = sorted[0]!;
    const incumbentNorm = normalizeStatement(incumbent.statement);
    const incumbentTokens = nameTokens(incumbentNorm);

    for (const f of sorted.slice(1)) {
      if (f.contradicts) continue;
      if (normalizeStatement(f.statement) === incumbentNorm) continue;
      // Skip paraphrases/restatements — only genuinely divergent statements flag.
      if (containmentOverlap(nameTokens(f.statement), incumbentTokens) >= PARAPHRASE_OVERLAP) {
        continue;
      }
      await db
        .updateTable("facts")
        .set({ contradicts: incumbent.id })
        .where("id", "=", f.id)
        .execute();
      linked++;
    }
  }

  return { linked };
}

/** A user's facts currently flagged as contradicting another. */
export async function listContradictions(db: Db, userId: string) {
  return db
    .selectFrom("facts as f")
    .innerJoin("facts as c", "c.id", "f.contradicts")
    .select([
      "f.id as id",
      "f.statement as statement",
      "f.source_episode as episode",
      "c.id as contradictsId",
      "c.statement as contradictsStatement",
    ])
    .where("f.user_id", "=", userId)
    .execute();
}
