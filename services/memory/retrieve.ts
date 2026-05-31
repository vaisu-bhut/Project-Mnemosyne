import {
  searchEntitiesByVector,
  searchEpisodesByVector,
  searchFactsByVector,
  type Db,
} from "../db/index.js";
import type { Embedder } from "../embeddings/index.js";
import type { TextGenerator } from "../llm/index.js";
import { resolveVisibility, type AccessContext } from "../guardian/index.js";
import { decryptText } from "../auth/crypto.js";

export interface SearchDeps {
  db: Db;
  /** Should be a query embedder (RETRIEVAL_QUERY for Gemini). */
  embedder: Embedder;
  /** Key to decrypt sensitive-tier episode bodies at rest (optional). */
  encKey?: string;
}

/** A citation back to the source of a claim — the "verify on click" anchor. */
export interface Citation {
  episodeId: string | null;
  sourceId: string | null;
}

export interface FactHit {
  id: string;
  statement: string;
  confidence: number;
  distance: number;
  citation: Citation;
}
export interface EpisodeHit {
  id: string;
  title: string | null;
  snippet: string | null;
  occurredAt: Date;
  distance: number;
  citation: Citation;
}
export interface EntityHit {
  id: string;
  canonicalName: string;
  type: string;
  distance: number;
}

export interface SearchResult {
  facts: FactHit[];
  episodes: EpisodeHit[];
  entities: EntityHit[];
}

function snippet(body: string | null, max = 200): string | null {
  if (!body) return null;
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Hybrid recall: cosine KNN over facts, episodes, and entities. Every fact and
 * episode carries a citation to its source episode/source — nothing floats.
 */
export async function searchMemory(
  deps: SearchDeps,
  userId: string,
  query: string,
  k = 5,
  ctx: AccessContext = {},
): Promise<SearchResult> {
  // Guardian: hide sources that aren't visible in this context.
  const { deniedSourceIds } = await resolveVisibility(deps.db, userId, ctx);
  const opts = { excludeSourceIds: deniedSourceIds };

  const qv = await deps.embedder.embedOne(query);
  const [facts, episodes, entities] = await Promise.all([
    searchFactsByVector(deps.db, userId, qv, k, opts),
    searchEpisodesByVector(deps.db, userId, qv, k, opts),
    searchEntitiesByVector(deps.db, userId, qv, k, opts),
  ]);

  // Decrypt sensitive-tier bodies that were encrypted at rest (when authorized).
  const readBody = (e: (typeof episodes)[number]): string | null => {
    if (e.body == null) return null;
    const encrypted = (e.meta as { encrypted?: boolean }).encrypted === true;
    if (!encrypted) return e.body;
    if (!deps.encKey) return null; // gated context without the key: hide it
    try {
      return decryptText(e.body, deps.encKey);
    } catch {
      return null;
    }
  };

  return {
    facts: facts.map((f) => ({
      id: f.id,
      statement: f.statement,
      confidence: f.confidence,
      distance: f.distance,
      citation: { episodeId: f.source_episode, sourceId: f.source_id },
    })),
    episodes: episodes.map((e) => ({
      id: e.id,
      title: e.title,
      snippet: snippet(readBody(e)),
      occurredAt: e.occurred_at,
      distance: e.distance,
      citation: { episodeId: e.id, sourceId: e.source_id },
    })),
    entities: entities.map((en) => ({
      id: en.id,
      canonicalName: en.canonical_name,
      type: en.type,
      distance: en.distance,
    })),
  };
}

export interface AskDeps extends SearchDeps {
  generator: TextGenerator;
}

export interface Answer {
  answer: string;
  citations: Citation[];
  used: { facts: FactHit[]; episodes: EpisodeHit[] };
}

/**
 * Answer a question grounded in retrieved memory. With a real generator the
 * model is constrained to the supplied context and told to cite episode ids;
 * the dev path returns the cited facts directly (no hallucination surface).
 */
export async function ask(
  deps: AskDeps,
  userId: string,
  question: string,
  k = 5,
  ctx: AccessContext = {},
): Promise<Answer> {
  const result = await searchMemory(deps, userId, question, k, ctx);
  const facts = result.facts;
  const episodes = result.episodes;
  const citations: Citation[] = [
    ...facts.map((f) => f.citation),
    ...episodes.map((e) => e.citation),
  ];
  const used = { facts, episodes };

  if (!deps.generator.available) {
    const lines = facts.length
      ? facts.map((f) => `- ${f.statement} [episode:${f.citation.episodeId}]`)
      : ["- (no relevant memory found)"];
    return {
      answer: `Based on stored memory:\n${lines.join("\n")}`,
      citations,
      used,
    };
  }

  const context = [
    ...facts.map((f) => `FACT [episode:${f.citation.episodeId}]: ${f.statement}`),
    ...episodes.map(
      (e) => `NOTE [episode:${e.id}] ${e.title ?? ""}: ${e.snippet ?? ""}`,
    ),
  ].join("\n");

  const prompt = `Answer the question using ONLY the context. If the context does not contain the answer, say you don't have that in memory. Cite supporting items inline as [episode:<id>]. Be concise.

CONTEXT:
${context || "(empty)"}

QUESTION: ${question}`;

  const answer = await deps.generator.generateText(prompt);
  return { answer: answer.trim(), citations, used };
}
