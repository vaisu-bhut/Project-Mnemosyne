import { z } from "zod";
import type { TextGenerator } from "../llm/index.js";

export type Intent = "recall" | "briefing" | "people" | "nudges";

export interface ClassifiedIntent {
  intent: Intent;
  /** A person/entity name the request is about, if any. */
  target: string | null;
}

const IntentSchema = z.object({
  intent: z.enum(["recall", "briefing", "people", "nudges"]).catch("recall"),
  target: z.string().nullish().transform((t) => t ?? null),
});

/**
 * LLM intent classifier for the Conductor — understands the request's meaning
 * even without trigger keywords, and extracts the target person. Throws on LLM
 * failure so the caller can fall back to keyword routing.
 */
export async function classifyIntent(
  query: string,
  generator: TextGenerator,
): Promise<ClassifiedIntent> {
  const prompt = `Classify the user's request into exactly one intent and extract the target person's name if there is one.
Intents:
- "recall": find or answer something from stored memory.
- "briefing": prepare for a meeting/interaction with a specific person.
- "people": relationship status/health ("how long since I talked to X", "who am I losing touch with").
- "nudges": what's on my mind / what should I do / open loops.
Return JSON {"intent":"...","target":"<person name or null>"}.

Request: ${query}`;

  return IntentSchema.parse(await generator.generateJson(prompt));
}
