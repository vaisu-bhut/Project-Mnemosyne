import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { getConfig } from "../config/index.js";
import {
  clearSourceReauth,
  createDb,
  listUserIds,
  updateIngestRun,
  updateSourceConfig,
  type IngestRunItem,
} from "../db/index.js";
import { GoogleReauthRequiredError } from "../auth/google.js";
import { MicrosoftReauthRequiredError } from "../auth/microsoft.js";
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
import { runNudger, upcomingBriefings } from "../agents/index.js";
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
// OAuth-backed kinds whose access can be revoked → flag needsReauth on failure.
const OAUTH_SOURCE_KINDS = new Set([
  "gmail",
  "gcal",
  "gcontacts",
  "msmail",
  "mscal",
  "mscontacts",
]);

// Distinguish a genuine re-auth failure (revoked/expired token, 401) from any
// other ingest error (e.g. an embedding 429, a disabled API) — only the former
// should flag the source as needing re-connection.
function isReauthError(err: unknown): boolean {
  if (err instanceof GoogleReauthRequiredError || err instanceof MicrosoftReauthRequiredError) {
    return true;
  }
  const msg = err instanceof Error ? err.message : "";
  return /\(401\)/.test(msg) || /invalid_grant/i.test(msg);
}

// Best-effort ingest_runs update — never let progress tracking break ingestion.
async function patchRun(runId: string | undefined, patch: Parameters<typeof updateIngestRun>[2]) {
  if (!runId) return;
  try {
    await updateIngestRun(db, runId, patch);
  } catch (err) {
    console.error(`[worker] failed to update ingest_run ${runId}:`, err);
  }
}

const ingestWorker = new Worker<IngestJob>(
  QUEUES.ingest,
  async (job) => {
    const { runId } = job.data;
    const source = await db
      .selectFrom("sources")
      .selectAll()
      .where("id", "=", job.data.sourceId)
      .executeTakeFirstOrThrow();

    await patchRun(runId, { status: "running" });
    // Keep a rolling sample of the most recent item titles for the live feed.
    const sample: IngestRunItem[] = [];

    let summary;
    try {
      const connector = await connectorForSource(source, { db, config });
      summary = await runIngest(
        { db, store, embedder, encKey: config.TOKEN_ENC_KEY },
        source,
        connector,
        {
          onProgress: async ({ ingested, total, lastItem }) => {
            sample.unshift(lastItem);
            if (sample.length > 8) sample.pop();
            await patchRun(runId, { ingested, total, items: [...sample] });
          },
        },
      );
    } catch (err) {
      // Only flag re-auth when the failure is genuinely an auth problem
      // (revoked/expired token, 401) — not for e.g. an embedding 429 or a
      // disabled API, which would otherwise mislead the user into reconnecting.
      if (OAUTH_SOURCE_KINDS.has(source.kind) && isReauthError(err)) {
        await updateSourceConfig(db, source.id, {
          ...(source.config as Record<string, unknown>),
          needsReauth: true,
        });
      }
      await patchRun(runId, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      });
      throw err;
    }

    // A clean run means the connection works — clear any stale reauth flag.
    if (OAUTH_SOURCE_KINDS.has(source.kind)) {
      await clearSourceReauth(db, source.id).catch(() => {});
    }

    await patchRun(runId, {
      status: "done",
      ingested: summary.ingested,
      total: summary.ingested,
      finishedAt: new Date(),
    });

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

// --- consolidate: the "sleep" pass, run per user ----------------------------
const consolidateWorker = new Worker<ConsolidateJob>(
  QUEUES.consolidate,
  async (job) => {
    const userIds = job.data.userId ? [job.data.userId] : await listUserIds(db);
    const opts = {
      decayMaxAgeDays: config.DECAY_MAX_AGE_DAYS,
      compressAfterDays: config.RETENTION_COMPRESS_AFTER_DAYS,
      purgeAfterDays: config.RETENTION_PURGE_AFTER_DAYS,
      entitySimThreshold: config.ENTITY_SIM_THRESHOLD,
      contradictionSimThreshold: config.CONTRADICTION_SIM_THRESHOLD,
      maxPairs: config.SEMANTIC_MAX_PAIRS,
    };
    // Semantic alias-resolution + contradiction NLI when enabled (else lexical).
    const cdeps = config.SEMANTIC_INTELLIGENCE ? { db, store, generator } : { db, store };
    for (const userId of userIds) await runConsolidation(cdeps, userId, opts);
    return { users: userIds.length };
  },
  { connection },
);

// --- nudge: proactive surfacing to the blackboard, per user -----------------
const nudgeWorker = new Worker<NudgeJob>(
  QUEUES.nudge,
  async (job) => {
    const userIds = job.data.userId ? [job.data.userId] : await listUserIds(db);
    for (const userId of userIds) {
      await runNudger(db, userId, { staleDays: config.RELATIONSHIP_STALE_DAYS });
      await upcomingBriefings({ db, generator, encKey: config.TOKEN_ENC_KEY }, userId, {
        withinHours: config.BRIEFING_LOOKAHEAD_HOURS,
        post: true,
      });
    }
    return { users: userIds.length };
  },
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
