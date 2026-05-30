import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import type { TextGenerator } from "../llm/index.js";

export type EntityType = "person" | "place" | "org" | "project" | "topic";
export type Direction = "i_owe" | "they_owe";

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}
export interface ExtractedFact {
  subject: string;
  statement: string;
  predicate?: string | null;
  object?: string | null;
  confidence?: number;
}
export interface ExtractedOpenLoop {
  description: string;
  direction: Direction;
  counterparty?: string | null;
}
export interface ExtractionResult {
  entities: ExtractedEntity[];
  facts: ExtractedFact[];
  openLoops: ExtractedOpenLoop[];
}

export interface EpisodeText {
  title?: string | null;
  body: string;
}

export interface Extractor {
  extract(input: EpisodeText): Promise<ExtractionResult>;
}

// --- dev (heuristic, offline, deterministic) -------------------------------

// Common capitalized words that are usually sentence-initial, not entities.
const STOPWORDS = new Set(
  [
    "The", "A", "An", "I", "We", "He", "She", "They", "It", "This", "That",
    "Had", "Have", "Has", "Met", "Saw", "Went", "Today", "Yesterday",
    "Tomorrow", "Then", "And", "But", "So", "My", "Our", "His", "Her",
    "Their", "At", "In", "On", "To", "From", "With", "By", "Need", "Let",
    "Dinner", "Lunch", "Coffee", "Note", "Reminder",
  ],
);

const PROPER_NOUN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
const I_OWE = /\b(i['’]?ll|i will|i need to|i owe|i should|let['’]?s|we should|we need to)\b/i;
const THEY_OWE = /\b(you owe|they owe|owes me|will get back to me|gets back to me)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function createDevExtractor(): Extractor {
  return {
    async extract({ title, body }) {
      const text = [title, body].filter(Boolean).join(". ");

      const names = new Set<string>();
      for (const m of text.matchAll(PROPER_NOUN)) {
        const name = m[0];
        const first = name.split(/\s+/)[0]!;
        if (!STOPWORDS.has(name) && !STOPWORDS.has(first)) names.add(name);
      }

      const entities: ExtractedEntity[] = [...names].map((name) => ({
        name,
        type: "person",
      }));

      const facts: ExtractedFact[] = [...names].map((name) => ({
        subject: name,
        statement: `${name} was mentioned in ${title ? `"${title}"` : "a note"}.`,
        predicate: "mentioned",
        confidence: 0.4,
      }));

      const openLoops: ExtractedOpenLoop[] = [];
      for (const s of sentences(body)) {
        if (THEY_OWE.test(s)) {
          openLoops.push({ description: s, direction: "they_owe" });
        } else if (I_OWE.test(s)) {
          openLoops.push({ description: s, direction: "i_owe" });
        }
      }

      return { entities, facts, openLoops };
    },
  };
}

// --- gemini (LLM-backed) ----------------------------------------------------

const ResultSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z
          .enum(["person", "place", "org", "project", "topic"])
          .catch("topic"),
      }),
    )
    .default([]),
  facts: z
    .array(
      z.object({
        subject: z.string().min(1),
        statement: z.string().min(1),
        predicate: z.string().nullish(),
        object: z.string().nullish(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
  openLoops: z
    .array(
      z.object({
        description: z.string().min(1),
        direction: z.enum(["i_owe", "they_owe"]).catch("i_owe"),
        counterparty: z.string().nullish(),
      }),
    )
    .default([]),
});

function buildPrompt({ title, body }: EpisodeText): string {
  return `You extract structured memory from a personal note. Return ONLY JSON matching:
{
  "entities":  [{ "name": string, "type": "person"|"place"|"org"|"project"|"topic" }],
  "facts":     [{ "subject": string, "statement": string, "predicate": string, "confidence": number 0..1 }],
  "openLoops": [{ "description": string, "direction": "i_owe"|"they_owe", "counterparty": string|null }]
}
Rules: only include items grounded in the text; "subject" must be an entity "name"; statements are concise and third-person; an open loop is a promise/commitment in either direction.

TITLE: ${title ?? "(none)"}
BODY:
${body}`;
}

function createGeminiExtractor(generator: TextGenerator): Extractor {
  return {
    async extract(input) {
      const raw = await generator.generateJson<unknown>(buildPrompt(input));
      const parsed = ResultSchema.parse(raw);
      return {
        entities: parsed.entities,
        facts: parsed.facts.map((f) => ({
          subject: f.subject,
          statement: f.statement,
          predicate: f.predicate ?? null,
          object: f.object ?? null,
          confidence: f.confidence,
        })),
        openLoops: parsed.openLoops.map((l) => ({
          description: l.description,
          direction: l.direction,
          counterparty: l.counterparty ?? null,
        })),
      };
    },
  };
}

export function createExtractor(
  config: Pick<AppConfig, "LLM_PROVIDER">,
  generator: TextGenerator,
): Extractor {
  return config.LLM_PROVIDER === "gemini"
    ? createGeminiExtractor(generator)
    : createDevExtractor();
}
