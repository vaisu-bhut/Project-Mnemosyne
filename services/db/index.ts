export { createDb, type Db } from "./client.js";
export type { Database } from "./types.js";
export type {
  FactStatus,
  LoopDirection,
  LoopStatus,
  RetentionTier,
} from "./types.js";
export { toVector, parseVector } from "./vector.js";

export {
  createSource,
  getSource,
  updateSourceConfig,
  clearSourceReauth,
  listSources,
  classifySource,
  type Source,
  type CreateSourceInput,
  type SourcePermissions,
} from "./repositories/sources.js";
export { upsertEntity, type Entity, type UpsertEntityInput } from "./repositories/entities.js";
export {
  insertEpisode,
  getEpisode,
  listEpisodes,
  type Episode,
  type InsertEpisodeInput,
  type ListEpisodesOptions,
} from "./repositories/episodes.js";
export {
  insertFact,
  listFacts,
  listFactsBySourceEpisode,
  reinforceFact,
  updateFact,
  deleteFact,
  type Fact,
  type InsertFactInput,
  type ListFactsOptions,
  type UpdateFactInput,
} from "./repositories/facts.js";
export {
  insertEdge,
  getNeighbors,
  type Edge,
  type InsertEdgeInput,
  type Neighbor,
} from "./repositories/edges.js";
export {
  searchEpisodesByVector,
  searchFactsByVector,
  searchEntitiesByVector,
  type WithDistance,
  type SearchOptions,
} from "./repositories/search.js";
export {
  createOpenLoop,
  listOpenLoops,
  type OpenLoop,
  type CreateOpenLoopInput,
} from "./repositories/openLoops.js";
export {
  writeBlackboard,
  listMind,
  getBlackboard,
  dismissBlackboard,
  clearAgentEntries,
  type BlackboardEntry,
  type WriteBlackboardInput,
} from "./repositories/blackboard.js";
export type { BlackboardStatus } from "./types.js";
export {
  snoozeNudge,
  activeSnoozedKeys,
} from "./repositories/snoozes.js";
export {
  createIngestRun,
  updateIngestRun,
  getLatestIngestRun,
  type IngestRun,
  type IngestRunItem,
  type UpdateIngestRunInput,
} from "./repositories/ingestRuns.js";
export type { IngestRunStatus } from "./types.js";
export {
  createUser,
  getUserByEmail,
  getUserById,
  listUserIds,
  type User,
  type CreateUserInput,
} from "./repositories/users.js";
export {
  createSession,
  findSessionByHash,
  deleteSessionByHash,
  type Session,
} from "./repositories/sessions.js";
export {
  upsertOauthAccount,
  linkOauthAccountForUser,
  listOauthAccounts,
  getOauthAccountById,
  getFirstOauthAccount,
  getOauthAccount,
  deleteOauthAccount,
  updateOauthTokens,
  type OauthAccount,
  type UpsertOauthAccountInput,
  type LinkOauthAccountResult,
} from "./repositories/oauthAccounts.js";
