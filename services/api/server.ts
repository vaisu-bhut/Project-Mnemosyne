import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import {
  createDb,
  createSource,
  listOpenLoops,
  type Db,
  type LoopStatus,
} from "../db/index.js";
import { createQueryEmbedder, type Embedder } from "../embeddings/index.js";
import { createGenerator, type TextGenerator } from "../llm/index.js";
import { ask, searchMemory } from "../memory/retrieve.js";
import {
  forgetEpisode,
  listContradictions,
  runConsolidation,
  setRetention,
  summarizeEntity,
  type ConsolidateOptions,
} from "../consolidate/index.js";
import { createArtifactStore, type ArtifactStore } from "../storage/index.js";
import { createIngestQueue } from "../queue/index.js";
import type { Queue } from "bullmq";
import type { IngestJob } from "../queue/index.js";

export interface ServerDeps {
  db: Db;
  store: ArtifactStore;
  redis: Redis;
  queryEmbedder: Embedder;
  generator: TextGenerator;
  ingestQueue: Queue<IngestJob>;
  consolidateOptions: ConsolidateOptions;
}

async function probe(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

const CreateSourceBody = z.object({
  kind: z.string().min(1),
  displayName: z.string().min(1),
  scope: z.string().optional(),
  sensitive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});
const SearchBody = z.object({ query: z.string().min(1), k: z.number().int().positive().max(50).optional() });
const AskBody = z.object({ question: z.string().min(1), k: z.number().int().positive().max(50).optional() });
const RetentionBody = z.object({
  episodeId: z.string().uuid(),
  tier: z.enum(["raw_forever", "standard", "ephemeral"]).optional(),
  compressAfter: z.string().optional(),
  purgeAfter: z.string().optional(),
  vaulted: z.boolean().optional(),
});

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const { db, store, redis, queryEmbedder, generator, ingestQueue, consolidateOptions } = deps;

  app.get("/health", async (_req, reply) => {
    const [database, redisOk, storage] = await Promise.all([
      probe(() => sql`SELECT 1`.execute(db)),
      probe(async () => {
        if ((await redis.ping()) !== "PONG") throw new Error("bad ping");
      }),
      probe(() => store.reachable()),
    ]);
    const ok = database && redisOk && storage;
    reply.code(ok ? 200 : 503);
    return { status: ok ? "ok" : "degraded", checks: { database, redis: redisOk, storage } };
  });

  // Register a connector/source.
  app.post("/sources", async (req, reply) => {
    const body = CreateSourceBody.parse(req.body);
    const source = await createSource(db, body);
    reply.code(201);
    return source;
  });

  // Trigger ingestion for a source (enqueues a job; the worker does the work).
  app.post<{ Params: { id: string } }>("/sources/:id/ingest", async (req, reply) => {
    const source = await db
      .selectFrom("sources")
      .selectAll()
      .where("id", "=", req.params.id)
      .executeTakeFirst();
    if (!source) {
      reply.code(404);
      return { error: "source not found" };
    }
    const job = await ingestQueue.add("ingest", { sourceId: source.id });
    reply.code(202);
    return { jobId: job.id, sourceId: source.id };
  });

  // Cited hybrid search over memory.
  app.post("/search", async (req) => {
    const { query, k } = SearchBody.parse(req.body);
    return searchMemory({ db, embedder: queryEmbedder }, query, k);
  });

  // Grounded question answering with citations.
  app.post("/ask", async (req) => {
    const { question, k } = AskBody.parse(req.body);
    return ask({ db, embedder: queryEmbedder, generator }, question, k);
  });

  // Open Loops dashboard.
  app.get<{ Querystring: { status?: LoopStatus } }>("/open-loops", async (req) => {
    return listOpenLoops(db, req.query.status);
  });

  // Run the consolidation ("sleep") pass now.
  app.post("/consolidate", async () => {
    return runConsolidation({ db, store }, consolidateOptions);
  });

  // Forget an episode across all stores (irreversible).
  app.post<{ Params: { id: string } }>("/episodes/:id/forget", async (req) => {
    return forgetEpisode({ db, store }, req.params.id);
  });

  // Set a per-episode retention policy.
  app.post("/retention", async (req, reply) => {
    const { episodeId, ...policy } = RetentionBody.parse(req.body);
    await setRetention(db, episodeId, policy);
    reply.code(204);
  });

  // Facts flagged as contradicting another.
  app.get("/contradictions", async () => listContradictions(db));

  // Build/refresh an entity's summary node.
  app.post<{ Params: { id: string } }>("/entities/:id/summarize", async (req) => {
    const summary = await summarizeEntity({ db, generator }, req.params.id);
    return { id: req.params.id, summary };
  });

  // Surface validation errors as 400s; preserve other Fastify status codes.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof z.ZodError) {
      reply.code(400);
      return { error: "invalid request", issues: err.issues };
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status);
    return { error: err.message || "internal error" };
  });

  return app;
}

export interface CreatedServer {
  app: FastifyInstance;
  deps: ServerDeps;
  shutdown(): Promise<void>;
}

export function createServer(config: AppConfig): CreatedServer {
  const db = createDb(config.DATABASE_URL);
  const store = createArtifactStore(config);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queryEmbedder = createQueryEmbedder(config);
  const generator = createGenerator(config);
  const ingestQueue = createIngestQueue(redis);
  const deps: ServerDeps = {
    db,
    store,
    redis,
    queryEmbedder,
    generator,
    ingestQueue,
    consolidateOptions: {
      decayMaxAgeDays: config.DECAY_MAX_AGE_DAYS,
      compressAfterDays: config.RETENTION_COMPRESS_AFTER_DAYS,
      purgeAfterDays: config.RETENTION_PURGE_AFTER_DAYS,
    },
  };
  const app = buildServer(deps);

  return {
    app,
    deps,
    async shutdown() {
      await app.close();
      await ingestQueue.close();
      await db.destroy();
      redis.disconnect();
    },
  };
}
