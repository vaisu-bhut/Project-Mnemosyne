import type { Db } from "../db/index.js";
import type { ArtifactStore } from "../storage/index.js";
import type { TextGenerator } from "../llm/index.js";
import { resolveEntities } from "./entities.js";
import { deduplicateFacts } from "./dedup.js";
import { detectContradictions } from "./contradictions.js";
import { decayFacts } from "./decay.js";
import { enforceRetention } from "./retention.js";

export { mergeEntities, resolveEntities } from "./entities.js";
export { deduplicateFacts } from "./dedup.js";
export { detectContradictions, listContradictions } from "./contradictions.js";
export { decayFacts } from "./decay.js";
export {
  setRetention,
  enforceRetention,
  forgetEpisode,
  type ForgetResult,
} from "./retention.js";
export { summarizeEntity, summarizeAllEntities } from "./summarize.js";

export interface ConsolidateDeps {
  db: Db;
  store: ArtifactStore;
  /** Supplying a generator switches alias resolution + contradiction detection
   *  to the semantic (embedding + LLM) strategies. */
  generator?: TextGenerator;
}

export interface ConsolidateOptions {
  decayMaxAgeDays?: number;
  compressAfterDays?: number;
  purgeAfterDays?: number;
  entitySimThreshold?: number;
  contradictionSimThreshold?: number;
  maxPairs?: number;
  now?: Date;
}

export interface ConsolidationReport {
  entitiesMerged: number;
  factsRetracted: number;
  contradictionsLinked: number;
  factsStaled: number;
  episodesCompressed: number;
  episodesPurged: number;
}

/**
 * The "sleep" pass. Order matters: resolve aliases first (which repoints facts
 * and can create duplicates), then dedup, then look for contradictions among
 * what remains, then decay, then enforce retention. Lexical by default (safe to
 * schedule offline); when `deps.generator` is set, alias resolution and
 * contradiction detection use the semantic strategies.
 */
export async function runConsolidation(
  deps: ConsolidateDeps,
  userId: string,
  opts: ConsolidateOptions = {},
): Promise<ConsolidationReport> {
  const { merged } = await resolveEntities(deps.db, userId, {
    generator: deps.generator,
    similarityThreshold: opts.entitySimThreshold,
    maxPairs: opts.maxPairs,
  });
  const { retracted } = await deduplicateFacts(deps.db, userId);
  const { linked } = await detectContradictions(deps.db, userId, {
    generator: deps.generator,
    similarityThreshold: opts.contradictionSimThreshold,
    maxPairs: opts.maxPairs,
  });
  const { staled } = await decayFacts(deps.db, userId, {
    maxAgeDays: opts.decayMaxAgeDays,
    now: opts.now,
  });
  const { compressed, purged } = await enforceRetention(deps, userId, {
    compressAfterDays: opts.compressAfterDays,
    purgeAfterDays: opts.purgeAfterDays,
    now: opts.now,
  });

  return {
    entitiesMerged: merged,
    factsRetracted: retracted,
    contradictionsLinked: linked,
    factsStaled: staled,
    episodesCompressed: compressed,
    episodesPurged: purged,
  };
}
