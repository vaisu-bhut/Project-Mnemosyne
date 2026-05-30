import type { Db } from "../db/index.js";
import type { TextGenerator } from "../llm/index.js";

export interface SummarizeDeps {
  db: Db;
  generator: TextGenerator;
}

/**
 * Build a summary node for an entity from its active facts and store it on
 * `attrs.summary`. With a real generator this is prose; the dev path lists the
 * facts. Returns the summary text (or null if the entity has no facts).
 */
export async function summarizeEntity(
  deps: SummarizeDeps,
  entityId: string,
): Promise<string | null> {
  const entity = await deps.db
    .selectFrom("entities")
    .select(["id", "canonical_name", "attrs"])
    .where("id", "=", entityId)
    .executeTakeFirstOrThrow();

  const facts = await deps.db
    .selectFrom("facts")
    .select(["statement"])
    .where("subject_id", "=", entityId)
    .where("status", "=", "active")
    .orderBy("reinforced", "desc")
    .limit(50)
    .execute();

  if (facts.length === 0) return null;
  const statements = facts.map((f) => f.statement);

  let summary: string;
  if (deps.generator.available) {
    summary = (
      await deps.generator.generateText(
        `Summarize what is known about "${entity.canonical_name}" in 2-3 sentences, using only these facts:\n` +
          statements.map((s) => `- ${s}`).join("\n"),
      )
    ).trim();
  } else {
    summary = `${entity.canonical_name}: ${statements.join(" ")}`;
  }

  await deps.db
    .updateTable("entities")
    .set({
      attrs: { ...entity.attrs, summary, summarized_at: new Date().toISOString() },
      updated_at: new Date(),
    })
    .where("id", "=", entityId)
    .execute();

  return summary;
}

/** Summarize every entity that has at least one active fact. */
export async function summarizeAllEntities(
  deps: SummarizeDeps,
): Promise<{ summarized: number }> {
  const ids = await deps.db
    .selectFrom("facts")
    .select("subject_id")
    .where("status", "=", "active")
    .distinct()
    .execute();

  let summarized = 0;
  for (const { subject_id } of ids) {
    const s = await summarizeEntity(deps, subject_id);
    if (s) summarized++;
  }
  return { summarized };
}
