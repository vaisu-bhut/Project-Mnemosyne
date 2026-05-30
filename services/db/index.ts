export { createDb, type Db } from "./client.js";
export type { Database } from "./types.js";
export type {
  FactStatus,
  LoopDirection,
  LoopStatus,
  RetentionTier,
} from "./types.js";
export { toVector, parseVector } from "./vector.js";

export { createSource, type Source, type CreateSourceInput } from "./repositories/sources.js";
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
