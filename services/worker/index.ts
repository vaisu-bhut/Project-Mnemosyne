import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { getConfig } from "../config/index.js";
import { createDb } from "../db/index.js";
import { createEmbedder } from "../embeddings/index.js";
import { createExtractor } from "../extract/index.js";
import { createGenerator } from "../llm/index.js";
import { createArtifactStore } from "../storage/index.js";
import {
  connectorForSource,
  runExtraction,
  runIngest,
} from "../ingest/pipeline.js";
import { runConsolidation } from "../consolidate/index.js";
import { runNudger } from "../agents/index.js";
import {
  QUEUES,
  type ConsolidateJob,
  type ExtractJob,
  type IngestJob,
  type NudgeJob,
} from "../queue/index.js";

const config = getConfig();

const db = createDb(config.DATABASE_URL);
const store = createArtifactStore(config);
const embedder = createEmbedder(config);
const generator = createGenerator(config);
const extractor = createExtractor(config, generator);

// BullMQ requires maxRetriesPerRequest: null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const extractQueue = new Queue<ExtractJob>(QUEUES.extract, { connection });
const consolidateQueue = new Queue<ConsolidateJob>(QUEUES.consolidate, { connection });
const nudgeQueue = new Queue<NudgeJob>(QUEUES.nudge, { connection });

// --- ingest: pull a source, create episodes, fan out extraction jobs --------
const ingestWorker = new Worker<IngestJob>(
  QUEUES.ingest,
  async (job) => {
    const source = await db
      .selectFrom("sources")
      .selectAll()
      .where("id", "=", job.data.sourceId)
      .executeTakeFirstOrThrow();
    const connector = await connectorForSource(source);
    const summary = await runIngest({ db, store, embedder }, source, connector);
    for (const episodeId of summary.episodeIds) {
      await extractQueue.add("extract", { episodeId, sourceId: source.id });
    }
    return summary;
  },
  { connection },
);

// --- extract: pull entities/facts/open-loops from one episode ---------------
const extractWorker = new Worker<ExtractJob>(
  QUEUES.extract,
  async (job) => runExtraction({ db, embedder, extractor }, job.data.episodeId),
  { connection },
);

// --- consolidate: the "sleep" pass ------------------------------------------
const consolidateWorker = new Worker<ConsolidateJob>(
  QUEUES.consolidate,
  async () =>
    runConsolidation(
      { db, store },
      {
        decayMaxAgeDays: config.DECAY_MAX_AGE_DAYS,
        compressAfterDays: config.RETENTION_COMPRESS_AFTER_DAYS,
        purgeAfterDays: config.RETENTION_PURGE_AFTER_DAYS,
      },
    ),
  { connection },
);

// --- nudge: proactive surfacing to the blackboard ---------------------------
const nudgeWorker = new Worker<NudgeJob>(
  QUEUES.nudge,
  async () => runNudger(db, { staleDays: config.RELATIONSHIP_STALE_DAYS }),
  { connection },
);

// --- healthcheck: prove wiring ----------------------------------------------
const healthWorker = new Worker(
  QUEUES.healthcheck,
  async (job) => ({ ok: true, echo: job.data }),
  { connection },
);

for (const w of [ingestWorker, extractWorker, consolidateWorker, nudgeWorker, healthWorker]) {
  w.on("ready", () => console.log(`[worker] ready: ${w.name}`));
  w.on("completed", (job, result) =>
    console.log(`[worker] ${w.name} job ${job.id} done:`, result),
  );
  w.on("failed", (job, err) =>
    console.error(`[worker] ${w.name} job ${job?.id} failed:`, err.message),
  );
}

// Run consolidation on a repeatable schedule (0 disables it).
if (config.CONSOLIDATE_INTERVAL_MS > 0) {
  await consolidateQueue.upsertJobScheduler(
    "nightly-consolidation",
    { every: config.CONSOLIDATE_INTERVAL_MS },
    { name: "consolidate" },
  );
  console.log(
    `[worker] consolidation scheduled every ${config.CONSOLIDATE_INTERVAL_MS}ms`,
  );
}

// Run the Nudger on a repeatable schedule (0 disables it).
if (config.NUDGER_INTERVAL_MS > 0) {
  await nudgeQueue.upsertJobScheduler(
    "periodic-nudger",
    { every: config.NUDGER_INTERVAL_MS },
    { name: "nudge" },
  );
  console.log(`[worker] nudger scheduled every ${config.NUDGER_INTERVAL_MS}ms`);
}

async function shutdown(): Promise<void> {
  await Promise.all([
    ingestWorker.close(),
    extractWorker.close(),
    consolidateWorker.close(),
    nudgeWorker.close(),
    healthWorker.close(),
    extractQueue.close(),
    consolidateQueue.close(),
    nudgeQueue.close(),
  ]);
  await db.destroy();
  connection.disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
