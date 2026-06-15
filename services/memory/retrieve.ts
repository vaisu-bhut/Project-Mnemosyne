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

/**
 * Page-context scope for grounded chat: bias the (still top-k) retrieval to a
 * specific entity / source / kind so "ask your brain" answers about *this page*
 * without dumping the whole page's data into the prompt.
 */
export interface RetrieveScope {
  entityId?: string;
  sourceId?: string;
  kind?: string;
}

/** One prior turn of a chat, fed to the LLM for multi-turn coherence. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
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
  scope: RetrieveScope = {},
): Promise<SearchResult> {
  // Guardian: hide sources that aren't visible in this context.
  const { deniedSourceIds } = await resolveVisibility(deps.db, userId, ctx);
  const base = { excludeSourceIds: deniedSourceIds, sourceId: scope.sourceId };
  // Page-context scoping: facts by subject entity; episodes by mentioned entity / kind.
  const factOpts = { ...base, subjectId: scope.entityId };
  const epOpts = { ...base, mentionedByEntityId: scope.entityId, kind: scope.kind };

  const qv = await deps.embedder.embedOne(query);
  const [facts, episodes, entities] = await Promise.all([
    searchFactsByVector(deps.db, userId, qv, k, factOpts),
    searchEpisodesByVector(deps.db, userId, qv, k, epOpts),
    searchEntitiesByVector(deps.db, userId, qv, k, base),
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
export interface AskOptions {
  /** Page-context scope to bias retrieval (entity/source/kind). */
  scope?: RetrieveScope;
  /** Prior turns for multi-turn coherence (LLM prompt only, not retrieval). */
  history?: ChatTurn[];
  /**
   * Max cosine distance for a hit to count as evidence. If nothing retrieved
   * lands within this, we refuse *without* calling the generator rather than
   * trusting it to admit ignorance. Cosine distance ∈ [0,2]; lower = closer.
   */
  evidenceMaxDistance?: number;
}

/** The fixed answer when memory holds no evidence for a question. The product
 * "defers to evidence": no source → it says so, deterministically. */
export const NO_EVIDENCE_ANSWER = "I don't have anything about that in your memory.";

/** Default relevance gate. Permissive enough not to misfire on loosely-related
 * matches, strict enough to catch "nothing relevant came back." */
const DEFAULT_EVIDENCE_MAX_DISTANCE = 0.85;

export async function ask(
  deps: AskDeps,
  userId: string,
  question: string,
  k = 5,
  ctx: AccessContext = {},
  options: AskOptions = {},
): Promise<Answer> {
  const result = await searchMemory(deps, userId, question, k, ctx, options.scope ?? {});
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

  // Hard evidence guard: with a real generator, if nothing retrieved is close
  // enough to be evidence, refuse deterministically instead of prompting the
  // model to (hopefully) admit it doesn't know. The dev path keeps its own
  // no-hallucination behavior above and is intentionally not gated here.
  const maxDistance = options.evidenceMaxDistance ?? DEFAULT_EVIDENCE_MAX_DISTANCE;
  const distances = [...facts, ...episodes].map((h) => h.distance);
  const hasEvidence = distances.some((d) => d <= maxDistance);
  if (!hasEvidence) {
    return { answer: NO_EVIDENCE_ANSWER, citations: [], used: { facts: [], episodes: [] } };
  }

  const context = [
    ...facts.map((f) => `FACT [episode:${f.citation.episodeId}]: ${f.statement}`),
    ...episodes.map(
      (e) => `NOTE [episode:${e.id}] ${e.title ?? ""}: ${e.snippet ?? ""}`,
    ),
  ].join("\n");

  const historyBlock = options.history?.length
    ? `\nCONVERSATION SO FAR:\n${options.history
        .map((h) => `${h.role === "user" ? "USER" : "ASSISTANT"}: ${h.content}`)
        .join("\n")}\n`
    : "";

  const prompt = `Answer the question using ONLY the context. If the context does not contain the answer, say you don't have that in memory. Cite supporting items inline as [episode:<id>]. Be concise.

CONTEXT:
${context || "(empty)"}
${historyBlock}
QUESTION: ${question}`;

  const answer = await deps.generator.generateText(prompt);
  return { answer: answer.trim(), citations, used };
}
