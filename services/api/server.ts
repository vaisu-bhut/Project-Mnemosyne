import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import {
  classifySource,
  createDb,
  createSource,
  dismissBlackboard,
  getSource,
  listMind,
  listOpenLoops,
  listSources,
  type Db,
  type LoopStatus,
} from "../db/index.js";
import type { AccessContext, Mode } from "../guardian/index.js";
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
  /** Use semantic (embedding + LLM) consolidation + routing. */
  semantic?: boolean;
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
const ModeField = {
  mode: z.enum(["default", "work", "guest"]).optional(),
  includeSensitive: z.boolean().optional(),
};
const SearchBody = z.object({
  query: z.string().min(1),
  k: z.number().int().positive().max(50).optional(),
  ...ModeField,
});
const AskBody = z.object({
  question: z.string().min(1),
  k: z.number().int().positive().max(50).optional(),
  ...ModeField,
});
const ConductBody = z.object({ query: z.string().min(1), ...ModeField });
const RetentionBody = z.object({
  episodeId: z.string().uuid(),
  tier: z.enum(["raw_forever", "standard", "ephemeral"]).optional(),
  compressAfter: z.string().optional(),
  purgeAfter: z.string().optional(),
  vaulted: z.boolean().optional(),
});
const ClassifyBody = z.object({
  sensitive: z.boolean().optional(),
  scope: z.string().min(1).optional(),
});

function accessContext(body: { mode?: Mode; includeSensitive?: boolean }): AccessContext {
  return { mode: body.mode, includeSensitive: body.includeSensitive };
}

// Paths reachable without a valid access token.
function isPublicPath(path: string): boolean {
  return path === "/health" || path === "/" || path.startsWith("/auth/");
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const { db, store, redis, config, queryEmbedder, generator, ingestQueue, consolidateOptions, relationshipStaleDays, semantic } = deps;
  const encKey = config.TOKEN_ENC_KEY;

  // CORS for the browser frontend (app/). Allowed origins come from WEB_ORIGIN
  // (comma-separated, or "*"). In dev the Next.js app proxies same-origin so this
  // is a no-op; it matters for real cross-origin / production deployments.
  const origins = config.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  app.register(cors, {
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

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

  // List the caller's sources (with privacy classification).
  app.get("/sources", async (req) => listSources(db, req.user!.id));

  // Classify a source for the Guardian (sensitive flag / scope).
  app.patch<{ Params: { id: string } }>("/sources/:id", async (req, reply) => {
    const patch = ClassifyBody.parse(req.body);
    const source = await classifySource(db, req.user!.id, req.params.id, patch);
    if (!source) {
      reply.code(404);
      return { error: "source not found" };
    }
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

  // Cited hybrid search over the caller's memory (Guardian-filtered by mode).
  app.post("/search", async (req) => {
    const { query, k, ...mode } = SearchBody.parse(req.body);
    return searchMemory({ db, embedder: queryEmbedder, encKey }, req.user!.id, query, k, accessContext(mode));
  });

  // Grounded question answering with citations (Guardian-filtered by mode).
  app.post("/ask", async (req) => {
    const { question, k, ...mode } = AskBody.parse(req.body);
    return ask({ db, embedder: queryEmbedder, generator, encKey }, req.user!.id, question, k, accessContext(mode));
  });

  // Open Loops dashboard.
  app.get<{ Querystring: { status?: LoopStatus } }>("/open-loops", async (req) => {
    return listOpenLoops(db, req.user!.id, req.query.status);
  });

  // Run the consolidation ("sleep") pass now for the caller.
  app.post("/consolidate", async (req) => {
    const cdeps = semantic ? { db, store, generator } : { db, store };
    return runConsolidation(cdeps, req.user!.id, consolidateOptions);
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
    return briefEntity({ db, generator, encKey }, req.user!.id, req.params.id);
  });

  // Time-triggered pre-meeting briefings for upcoming calendar events.
  app.get<{ Querystring: { hours?: string } }>("/briefings/upcoming", async (req) => {
    const withinHours = req.query.hours ? Number(req.query.hours) : 24;
    return upcomingBriefings({ db, generator, encKey }, req.user!.id, { withinHours });
  });

  // The Conductor: route a free-text query to the right agent.
  app.post("/conduct", async (req) => {
    const { query, ...mode } = ConductBody.parse(req.body);
    return route({ db, queryEmbedder, generator, encKey }, req.user!.id, query, accessContext(mode), semantic);
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
      entitySimThreshold: config.ENTITY_SIM_THRESHOLD,
      contradictionSimThreshold: config.CONTRADICTION_SIM_THRESHOLD,
      maxPairs: config.SEMANTIC_MAX_PAIRS,
    },
    relationshipStaleDays: config.RELATIONSHIP_STALE_DAYS,
    semantic: config.SEMANTIC_INTELLIGENCE,
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
