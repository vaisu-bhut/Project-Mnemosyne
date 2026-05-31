import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import {
  createDb,
  createSource,
  dismissBlackboard,
  getSource,
  listMind,
  listOpenLoops,
  type Db,
  type LoopStatus,
} from "../db/index.js";
import {
  briefEntity,
  relationshipHealthAll,
  route,
  runNudger,
  upcomingBriefings,
} from "../agents/index.js";
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
import {
  getUserFromRequest,
  registerAuthRoutes,
  type AuthUser,
} from "../auth/index.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export interface ServerDeps {
  db: Db;
  store: ArtifactStore;
  redis: Redis;
  config: AppConfig;
  queryEmbedder: Embedder;
  generator: TextGenerator;
  ingestQueue: Queue<IngestJob>;
  consolidateOptions: ConsolidateOptions;
  relationshipStaleDays: number;
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
const ConductBody = z.object({ query: z.string().min(1) });
const RetentionBody = z.object({
  episodeId: z.string().uuid(),
  tier: z.enum(["raw_forever", "standard", "ephemeral"]).optional(),
  compressAfter: z.string().optional(),
  purgeAfter: z.string().optional(),
  vaulted: z.boolean().optional(),
});

// Paths reachable without a valid access token.
function isPublicPath(path: string): boolean {
  return path === "/health" || path === "/" || path.startsWith("/auth/");
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const { db, store, redis, config, queryEmbedder, generator, ingestQueue, consolidateOptions, relationshipStaleDays } = deps;

  // Authentication guard: populate req.user from the Bearer token; reject
  // protected routes without a valid one. Every handler below is user-scoped.
  app.addHook("onRequest", async (req, reply) => {
    const path = (req.url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
    const user = await getUserFromRequest(config, req);
    if (user) req.user = user;
    if (!isPublicPath(path) && !req.user) {
      await reply.code(401).send({ error: "authentication required" });
    }
  });

  registerAuthRoutes(app, { db, config });

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

  // Register a connector/source owned by the caller.
  app.post("/sources", async (req, reply) => {
    const body = CreateSourceBody.parse(req.body);
    const source = await createSource(db, { userId: req.user!.id, ...body });
    reply.code(201);
    return source;
  });

  // Trigger ingestion for one of the caller's sources.
  app.post<{ Params: { id: string } }>("/sources/:id/ingest", async (req, reply) => {
    const source = await getSource(db, req.user!.id, req.params.id);
    if (!source) {
      reply.code(404);
      return { error: "source not found" };
    }
    const job = await ingestQueue.add("ingest", { sourceId: source.id });
    reply.code(202);
    return { jobId: job.id, sourceId: source.id };
  });

  // Cited hybrid search over the caller's memory.
  app.post("/search", async (req) => {
    const { query, k } = SearchBody.parse(req.body);
    return searchMemory({ db, embedder: queryEmbedder }, req.user!.id, query, k);
  });

  // Grounded question answering with citations.
  app.post("/ask", async (req) => {
    const { question, k } = AskBody.parse(req.body);
    return ask({ db, embedder: queryEmbedder, generator }, req.user!.id, question, k);
  });

  // Open Loops dashboard.
  app.get<{ Querystring: { status?: LoopStatus } }>("/open-loops", async (req) => {
    return listOpenLoops(db, req.user!.id, req.query.status);
  });

  // Run the consolidation ("sleep") pass now for the caller.
  app.post("/consolidate", async (req) => {
    return runConsolidation({ db, store }, req.user!.id, consolidateOptions);
  });

  // Forget an episode across all stores (irreversible).
  app.post<{ Params: { id: string } }>("/episodes/:id/forget", async (req) => {
    return forgetEpisode({ db, store }, req.user!.id, req.params.id);
  });

  // Set a per-episode retention policy.
  app.post("/retention", async (req, reply) => {
    const { episodeId, ...policy } = RetentionBody.parse(req.body);
    await setRetention(db, req.user!.id, episodeId, policy);
    reply.code(204);
  });

  // Facts flagged as contradicting another.
  app.get("/contradictions", async (req) => listContradictions(db, req.user!.id));

  // Build/refresh an entity's summary node.
  app.post<{ Params: { id: string } }>("/entities/:id/summarize", async (req) => {
    const summary = await summarizeEntity({ db, generator }, req.user!.id, req.params.id);
    return { id: req.params.id, summary };
  });

  // --- Agent mesh ---

  // "What's on my mind": the caller's most salient working-memory entries.
  app.get<{ Querystring: { k?: string } }>("/mind", async (req) => {
    const k = req.query.k ? Number(req.query.k) : 10;
    return listMind(db, req.user!.id, k);
  });

  // Run the Nudger now (also runs on a schedule in the worker).
  app.post("/agents/nudger/run", async (req) => {
    return runNudger(db, req.user!.id, { staleDays: relationshipStaleDays });
  });

  // Relationship health across the caller's people.
  app.get("/people/health", async (req) => relationshipHealthAll(db, req.user!.id));

  // Pre-meeting briefing for a person.
  app.get<{ Params: { id: string } }>("/people/:id/brief", async (req) => {
    return briefEntity({ db, generator }, req.user!.id, req.params.id);
  });

  // Time-triggered pre-meeting briefings for upcoming calendar events.
  app.get<{ Querystring: { hours?: string } }>("/briefings/upcoming", async (req) => {
    const withinHours = req.query.hours ? Number(req.query.hours) : 24;
    return upcomingBriefings({ db, generator }, req.user!.id, { withinHours });
  });

  // The Conductor: route a free-text query to the right agent.
  app.post("/conduct", async (req) => {
    const { query } = ConductBody.parse(req.body);
    return route({ db, queryEmbedder, generator }, req.user!.id, query);
  });

  // Dismiss a blackboard entry.
  app.post<{ Params: { id: string } }>("/blackboard/:id/dismiss", async (req, reply) => {
    await dismissBlackboard(db, req.user!.id, req.params.id);
    reply.code(204);
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
    config,
    queryEmbedder,
    generator,
    ingestQueue,
    consolidateOptions: {
      decayMaxAgeDays: config.DECAY_MAX_AGE_DAYS,
      compressAfterDays: config.RETENTION_COMPRESS_AFTER_DAYS,
      purgeAfterDays: config.RETENTION_PURGE_AFTER_DAYS,
    },
    relationshipStaleDays: config.RELATIONSHIP_STALE_DAYS,
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
