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
  userId: string,
  entityId: string,
): Promise<string | null> {
  const entity = await deps.db
    .selectFrom("entities")
    .select(["id", "canonical_name", "attrs", "type"])
    .where("id", "=", entityId)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();

  const facts = await deps.db
    .selectFrom("facts")
    .select(["statement"])
    .where("user_id", "=", userId)
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

  let suggestedQuestions: string[] | undefined;
  if (entity.type === "person" && deps.generator.available) {
    const openLoops = await deps.db
      .selectFrom("open_loops")
      .select(["description", "direction"])
      .where("user_id", "=", userId)
      .where("counterparty", "=", entityId)
      .where("status", "=", "open")
      .execute();

    const context = [
      summary ? `About ${entity.canonical_name}: ${summary}` : "",
      ...openLoops.map((t) => `Open thread (${t.direction === "i_owe" ? "i_owe" : "they_owe"}): ${t.description}`),
      ...statements.slice(0, 5).map((f) => `Fact: ${f}`),
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const raw = await deps.generator.generateText(
        `You're prepping me to see ${entity.canonical_name}. From this context, suggest 3 short, specific questions I could ask them. One per line, no numbering.\n\n${context || "(little is known)"}`,
        { enableThinking: false },
      );
      suggestedQuestions = raw
        .split("\n")
        .map((l) => l.replace(/^[\s\-*\d.]+/, "").trim())
        .filter(Boolean)
        .slice(0, 5);
    } catch (e) {
      console.error(`Failed to precompute questions for ${entity.canonical_name}:`, e);
    }
  }

  await deps.db
    .updateTable("entities")
    .set({
      attrs: {
        ...entity.attrs,
        summary,
        summarized_at: new Date().toISOString(),
        ...(suggestedQuestions ? { suggestedQuestions } : {}),
      },
      updated_at: new Date(),
    })
    .where("id", "=", entityId)
    .execute();

  return summary;
}

/** Summarize every entity (for a user) that has at least one active fact. */
export async function summarizeAllEntities(
  deps: SummarizeDeps,
  userId: string,
): Promise<{ summarized: number }> {
  const ids = await deps.db
    .selectFrom("facts")
    .select("subject_id")
    .where("user_id", "=", userId)
    .where("status", "=", "active")
    .distinct()
    .execute();

  let summarized = 0;
  for (const { subject_id } of ids) {
    const s = await summarizeEntity(deps, userId, subject_id);
    if (s) summarized++;
  }
  return { summarized };
}
