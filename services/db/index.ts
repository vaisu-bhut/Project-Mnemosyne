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
  type Source,
  type CreateSourceInput,
} from "./repositories/sources.js";
export { upsertEntity, type Entity, type UpsertEntityInput } from "./repositories/entities.js";
export { insertEpisode, type Episode, type InsertEpisodeInput } from "./repositories/episodes.js";
export {
  insertFact,
  reinforceFact,
  type Fact,
  type InsertFactInput,
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
  dismissBlackboard,
  clearAgentEntries,
  type BlackboardEntry,
  type WriteBlackboardInput,
} from "./repositories/blackboard.js";
export type { BlackboardStatus } from "./types.js";
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
  getOauthAccount,
  updateOauthTokens,
  type OauthAccount,
} from "./repositories/oauthAccounts.js";
