import { Queue } from "bullmq";
import type { Redis } from "ioredis";

/** Queue names, shared between the API (producer) and worker (consumer). */
export const QUEUES = {
  healthcheck: "healthcheck",
  ingest: "ingest",
  extract: "extract",
  consolidate: "consolidate",
  nudge: "nudge",
} as const;

export interface IngestJob {
  sourceId: string;
}
export interface ExtractJob {
  episodeId: string;
  sourceId: string;
}
// Optional userId: scheduled runs omit it (process all users); on-demand runs
// from the API set it to the requesting user.
export interface ConsolidateJob {
  userId?: string;
}
export interface NudgeJob {
  userId?: string;
}

export function createIngestQueue(connection: Redis): Queue<IngestJob> {
  return new Queue<IngestJob>(QUEUES.ingest, { connection });
}
export function createExtractQueue(connection: Redis): Queue<ExtractJob> {
  return new Queue<ExtractJob>(QUEUES.extract, { connection });
}
export function createConsolidateQueue(connection: Redis): Queue<ConsolidateJob> {
  return new Queue<ConsolidateJob>(QUEUES.consolidate, { connection });
}
export function createNudgeQueue(connection: Redis): Queue<NudgeJob> {
  return new Queue<NudgeJob>(QUEUES.nudge, { connection });
}
