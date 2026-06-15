import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import {
  classifySource,
  createDb,
  createIngestRun,
  createSource,
  deleteFact,
  deleteOauthAccount,
  dismissBlackboard,
  getBlackboard,
  snoozeNudge,
  getLatestIngestRun,
  getEpisode,
  getOauthAccountById,
  getSource,
  listEpisodes,
  listFacts,
  listFactsBySourceEpisode,
  listMind,
  listOauthAccounts,
  listOpenLoops,
  listSources,
  updateFact,
  type Db,
  type LoopStatus,
  type OauthAccount,
} from "../db/index.js";
import { servicesFromScope } from "../auth/scopes.js";
import {
  briefEntity,
  peopleGraph,
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
  mergeEntities,
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

const PermissionsField = z.object({
  read: z.boolean(),
  write: z.boolean(),
  delete: z.boolean(),
  mode: z.enum(["autonomous", "approval"]),
});
const CreateSourceBody = z.object({
  kind: z.string().min(1),
  displayName: z.string().min(1),
  scope: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  permissions: PermissionsField.optional(),
  oauthAccountId: z.string().uuid().optional(),
});

// OAuth-backed source kinds → the provider whose account they pull from.
const OAUTH_KIND_PROVIDER: Record<string, string> = {
  gmail: "google",
  gcal: "google",
  gcontacts: "google",
  msmail: "microsoft",
  mscal: "microsoft",
  mscontacts: "microsoft",
};

/** Shape a connected account for the API (never exposes tokens). */
function toAccountView(a: OauthAccount) {
  const expired = !a.expires_at || a.expires_at.getTime() < Date.now();
  return {
    id: a.id,
    provider: a.provider,
    email: a.email,
    displayName: a.display_name,
    providerAccountId: a.provider_account_id,
    services: servicesFromScope(a.scope),
    scopeRaw: a.scope,
    expiresAt: a.expires_at ? a.expires_at.toISOString() : null,
    // Heuristic (no network probe): can't mint a token without a refresh token
    // once the access token has expired.
    needsReauth: !a.refresh_token && expired,
  };
}
const SearchBody = z.object({
  query: z.string().min(1),
  k: z.number().int().positive().max(50).optional(),
});
const ScopeField = z
  .object({
    entityId: z.string().uuid().optional(),
    sourceId: z.string().uuid().optional(),
    kind: z.string().min(1).optional(),
  })
  .optional();
const AskBody = z.object({
  question: z.string().min(1),
  k: z.number().int().positive().max(50).optional(),
  // Page-context chat: bias retrieval + carry conversation history.
  scope: ScopeField,
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
    .max(20)
    .optional(),
});
const ConductBody = z.object({ query: z.string().min(1) });
const MergeEntitiesBody = z.object({
  // The entity to keep; `dupeId` is folded into it and removed.
  survivorId: z.string().uuid(),
  dupeId: z.string().uuid(),
});
const SnoozeBody = z.object({
  // How long to suppress the nudge. Default one day; capped at ~30 days.
  hours: z.number().positive().max(720).optional().default(24),
});
const RetentionBody = z.object({
  episodeId: z.string().uuid(),
  tier: z.enum(["raw_forever", "standard", "ephemeral"]).optional(),
  compressAfter: z.string().optional(),
  purgeAfter: z.string().optional(),
  vaulted: z.boolean().optional(),
});
const ClassifyBody = z.object({
  scope: z.string().min(1).optional(),
  permissions: PermissionsField.optional(),
});
const UpdateFactBody = z.object({
  statement: z.string().min(1).optional(),
  status: z.enum(["active", "stale", "retracted"]).optional(),
});

// Query params arrive as strings; coerce.
const EpisodesQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  kind: z.string().min(1).optional(),
  sourceId: z.string().uuid().optional(),
});
const FactsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(["active", "stale", "retracted"]).optional(),
  subjectId: z.string().uuid().optional(),
});

/** Build a plaintext snippet from an episode body. */
function bodySnippet(body: string | null, max = 200): string | null {
  if (body == null) return null;
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Paths reachable without a valid access token.
function isPublicPath(path: string): boolean {
  return path === "/health" || path === "/" || path.startsWith("/auth/");
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const { db, store, redis, config, queryEmbedder, generator, ingestQueue, consolidateOptions, relationshipStaleDays, semantic } = deps;

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
    const expectedProvider = OAUTH_KIND_PROVIDER[body.kind];

    if (body.oauthAccountId !== undefined) {
      if (!expectedProvider) {
        reply.code(400);
        return { error: `source kind "${body.kind}" does not use a connected account` };
      }
      const acct = await getOauthAccountById(db, req.user!.id, body.oauthAccountId);
      if (!acct) {
        reply.code(400);
        return { error: "oauthAccountId not found for this user" };
      }
      if (acct.provider !== expectedProvider) {
        reply.code(400);
        return { error: `oauthAccountId is not a ${expectedProvider} account` };
      }
    }

    const source = await createSource(db, { userId: req.user!.id, ...body });
    reply.code(201);
    return source;
  });

  // List the caller's sources (with privacy classification).
  app.get("/sources", async (req) => listSources(db, req.user!.id));

  // List the caller's connected OAuth accounts + the services each granted.
  app.get("/accounts", async (req) => {
    const accounts = await listOauthAccounts(db, req.user!.id);
    return accounts.map(toAccountView);
  });

  // Disconnect a connected account. Bound sources survive (oauth_account_id is
  // set to NULL by the FK) and fall back to another account or fail at ingest.
  app.delete<{ Params: { id: string } }>("/accounts/:id", async (req, reply) => {
    const ok = await deleteOauthAccount(db, req.user!.id, req.params.id);
    if (!ok) {
      reply.code(404);
      return { error: "account not found" };
    }
    reply.code(204);
  });

  // Update a source's scope / permissions.
  app.patch<{ Params: { id: string } }>("/sources/:id", async (req, reply) => {
    const patch = ClassifyBody.parse(req.body);
    const source = await classifySource(db, req.user!.id, req.params.id, patch);
    if (!source) {
      reply.code(404);
      return { error: "source not found" };
    }
    return source;
  });

  // Trigger ingestion for one of the caller's sources. Opens an ingest_runs row
  // (status 'queued') so the UI can show live progress, and passes its id to the
  // worker via the job payload.
  app.post<{ Params: { id: string } }>("/sources/:id/ingest", async (req, reply) => {
    const source = await getSource(db, req.user!.id, req.params.id);
    if (!source) {
      reply.code(404);
      return { error: "source not found" };
    }
    const run = await createIngestRun(db, req.user!.id, source.id);
    const job = await ingestQueue.add("ingest", { sourceId: source.id, runId: run.id });
    reply.code(202);
    return { jobId: job.id, sourceId: source.id, runId: run.id };
  });

  // Latest ingest run for a source (live status + recently-ingested item sample).
  app.get<{ Params: { id: string } }>("/sources/:id/ingest-status", async (req, reply) => {
    const run = await getLatestIngestRun(db, req.user!.id, req.params.id);
    if (!run) {
      reply.code(404);
      return { error: "no ingest run for this source" };
    }
    return {
      id: run.id,
      sourceId: run.source_id,
      status: run.status,
      ingested: run.ingested,
      total: run.total,
      items: run.items,
      error: run.error,
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at ? run.finished_at.toISOString() : null,
    };
  });

  // Cited hybrid search over the caller's memory.
  app.post("/search", async (req) => {
    const { query, k } = SearchBody.parse(req.body);
    return searchMemory({ db, embedder: queryEmbedder }, req.user!.id, query, k);
  });

  // Grounded question answering with citations.
  app.post("/ask", async (req) => {
    const { question, k, scope, history } = AskBody.parse(req.body);
    return ask(
      { db, embedder: queryEmbedder, generator },
      req.user!.id,
      question,
      k,
      { scope, history },
    );
  });

  // Browse the caller's episodes (newest first, paginated).
  app.get("/episodes", async (req) => {
    const q = EpisodesQuery.parse(req.query);
    const rows = await listEpisodes(db, req.user!.id, {
      limit: q.limit,
      offset: q.offset,
      kind: q.kind,
      sourceId: q.sourceId,
    });
    return rows.map((e) => ({
      id: e.id,
      occurredAt: e.occurred_at.toISOString(),
      kind: e.kind,
      title: e.title,
      sourceId: e.source_id,
      snippet: bodySnippet(e.body),
      artifactUri: e.artifact_uri,
    }));
  });

  // Browse the caller's facts (most-reinforced first, paginated).
  app.get("/facts", async (req) => {
    const q = FactsQuery.parse(req.query);
    const rows = await listFacts(db, req.user!.id, {
      limit: q.limit,
      offset: q.offset,
      status: q.status,
      subjectId: q.subjectId,
    });
    const maxAgeDays = consolidateOptions.decayMaxAgeDays ?? 90;
    const MIN_REINFORCED = 2; // mirrors decayFacts: reinforced facts are protected
    const DAY_MS = 86_400_000;
    const nowMs = Date.now();
    return rows.map((f) => {
      // A fact is protected from decay once it's been reconfirmed or reinforced
      // enough (see consolidate/decay.ts). Otherwise it ages toward 'stale'.
      const protectedFromDecay = f.last_confirmed != null || f.reinforced >= MIN_REINFORCED;
      const since = (f.last_confirmed ?? f.learned_at).getTime();
      const ageDays = Math.max(0, (nowMs - since) / DAY_MS);
      const decay = protectedFromDecay ? 0 : Math.min(1, ageDays / maxAgeDays);
      const decaysInDays = protectedFromDecay ? null : Math.max(0, Math.ceil(maxAgeDays - ageDays));
      return {
        id: f.id,
        statement: f.statement,
        predicate: f.predicate,
        subjectId: f.subject_id,
        objectId: f.object_id,
        status: f.status,
        reinforced: f.reinforced,
        confidence: f.confidence,
        sourceEpisode: f.source_episode,
        sourceId: f.source_id,
        contradicts: f.contradicts,
        learnedAt: f.learned_at.toISOString(),
        lastConfirmedAt: f.last_confirmed ? f.last_confirmed.toISOString() : null,
        // 0 = fresh/protected, 1 = at the decay threshold.
        decay: Number(decay.toFixed(2)),
        protectedFromDecay,
        decaysInDays,
      };
    });
  });

  // Edit a derived fact (statement/status). Memory/episodes are never touched.
  app.patch<{ Params: { id: string } }>("/facts/:id", async (req, reply) => {
    const patch = UpdateFactBody.parse(req.body);
    const fact = await updateFact(db, req.user!.id, req.params.id, patch);
    if (!fact) {
      reply.code(404);
      return { error: "fact not found" };
    }
    return fact;
  });

  // Delete a derived fact (the source episode remains as proof).
  app.delete<{ Params: { id: string } }>("/facts/:id", async (req, reply) => {
    const ok = await deleteFact(db, req.user!.id, req.params.id);
    if (!ok) {
      reply.code(404);
      return { error: "fact not found" };
    }
    reply.code(204);
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

  // Extraction trace for one episode: the source, then the facts derived from
  // it with their trust/reinforcement history. Powers the Ask citation → source
  // → "from this, I derived this, last reinforced N days ago" panel.
  app.get<{ Params: { id: string } }>(
    "/episodes/:id/trace",
    async (req, reply) => {
      const episode = await getEpisode(db, req.user!.id, req.params.id);
      if (!episode) {
        reply.code(404);
        return { error: "episode not found" };
      }

      const facts = await listFactsBySourceEpisode(db, req.user!.id, req.params.id);
      const now = Date.now();
      const DAY_MS = 86_400_000;
      return {
        episode: {
          id: episode.id,
          occurredAt: episode.occurred_at.toISOString(),
          kind: episode.kind,
          title: episode.title,
          sourceId: episode.source_id,
          snippet: bodySnippet(episode.body, 600),
          artifactUri: episode.artifact_uri,
        },
        facts: facts.map((f) => {
          const lastReinforced = f.last_confirmed ?? f.learned_at;
          return {
            id: f.id,
            statement: f.statement,
            predicate: f.predicate,
            subjectId: f.subject_id,
            objectId: f.object_id,
            status: f.status,
            confidence: f.confidence,
            reinforced: f.reinforced,
            contradicts: f.contradicts,
            learnedAt: f.learned_at.toISOString(),
            lastReinforcedAt: lastReinforced.toISOString(),
            daysSinceReinforced: Math.floor((now - lastReinforced.getTime()) / DAY_MS),
          };
        }),
      };
    },
  );

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

  // Merge two of the caller's entities ("these are the same person"). Folds
  // dupe into survivor (aliases, attrs, facts, edges). Owner-scoped: both must
  // belong to the caller, or it 404s — mergeEntities itself isn't user-scoped.
  app.post("/entities/merge", async (req, reply) => {
    const { survivorId, dupeId } = MergeEntitiesBody.parse(req.body);
    if (survivorId === dupeId) {
      reply.code(400);
      return { error: "survivorId and dupeId must differ" };
    }
    const owned = await db
      .selectFrom("entities")
      .select("id")
      .where("user_id", "=", req.user!.id)
      .where("id", "in", [survivorId, dupeId])
      .execute();
    if (owned.length !== 2) {
      reply.code(404);
      return { error: "entity not found" };
    }
    await mergeEntities(db, survivorId, dupeId);
    return { survivorId, mergedId: dupeId };
  });

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

  // The people graph: person nodes (closeness + circle) and weighted co_occurs
  // links. Capped to the most-connected people; built during consolidation.
  app.get<{ Querystring: { limit?: string } }>("/graph", async (req) => {
    const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit), 1), 200) : 60;
    return peopleGraph(db, req.user!.id, { limit });
  });

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
    return route({ db, queryEmbedder, generator }, req.user!.id, query, semantic);
  });

  // Dismiss a blackboard entry.
  app.post<{ Params: { id: string } }>("/blackboard/:id/dismiss", async (req, reply) => {
    await dismissBlackboard(db, req.user!.id, req.params.id);
    reply.code(204);
  });

  // Snooze a nudge: hide it now and suppress its regeneration until later. The
  // snooze is keyed to the nudge's source (payload.key) so the Nudger won't
  // re-post it on its next run; entries without a source key just dismiss.
  app.post<{ Params: { id: string } }>("/blackboard/:id/snooze", async (req, reply) => {
    const { hours } = SnoozeBody.parse(req.body ?? {});
    const entry = await getBlackboard(db, req.user!.id, req.params.id);
    if (!entry) {
      reply.code(404);
      return { error: "entry not found" };
    }
    const key = (entry.payload as { key?: string } | null)?.key;
    const until = new Date(Date.now() + hours * 3_600_000);
    if (key) await snoozeNudge(db, req.user!.id, key, until);
    await dismissBlackboard(db, req.user!.id, req.params.id);
    return { snoozedUntil: key ? until.toISOString() : null };
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
