import { z } from "zod";

/**
 * The embedding vector dimension. Single source of truth used by the
 * application; the SQL migrations read the same value from the VECTOR_DIM env
 * var. Change it here (and in .env) only while the database is still empty —
 * existing `vector(N)` columns cannot be resized in place.
 *
 * Default 1024 = Qwen text-embedding-v3.
 */
export const DEFAULT_VECTOR_DIM = 1024;

/** Coerce an env string ("true"/"false") or boolean into a boolean. */
const envBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"));

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),

  VECTOR_DIM: z.coerce.number().int().positive().default(DEFAULT_VECTOR_DIM),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Local directory where raw artifacts are stored. Swap for S3 later by
  // replacing the storage module; this is the only config it needs today.
  LOCAL_STORAGE_DIR: z.string().default("./.data/artifacts"),

  // --- Embeddings ---
  // "dev"    = deterministic local embedder (no network/secrets, used in tests)
  // "gemini" = Google gemini-embedding-001 via the Gemini API (AI Studio key)
  // "qwen"   = Qwen text-embedding-v3 via an OpenAI-compatible endpoint
  EMBEDDING_PROVIDER: z.enum(["dev", "gemini", "qwen"]).default("dev"),
  EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  // Optional override; each provider has a sensible default base URL.
  EMBEDDING_BASE_URL: z.string().url().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  // Gemini task type hint (RETRIEVAL_DOCUMENT for stored memory,
  // RETRIEVAL_QUERY for search queries). Improves retrieval quality.
  EMBEDDING_TASK_TYPE: z.string().default("RETRIEVAL_DOCUMENT"),

  // --- Generative LLM (extraction + grounded answers + semantic adjudication) ---
  // "dev"    = deterministic offline stand-in (heuristics; no network).
  // "qwen"   = Qwen chat via DashScope's OpenAI-compatible endpoint (QWEN_API_KEY).
  // "gemini" = Gemini generateContent, reusing EMBEDDING_API_KEY.
  // NOTE: Gemini is used for EMBEDDINGS; Qwen is the default generative LLM.
  LLM_PROVIDER: z.enum(["dev", "qwen", "gemini"]).default("dev"),
  LLM_MODEL: z.string().default("gemini-2.5-flash"),
  // Qwen (DashScope OpenAI-compatible). Key is separate from the Gemini key.
  QWEN_API_KEY: z.string().optional(),
  QWEN_MODEL: z.string().default("qwen-plus"),
  QWEN_BASE_URL: z
    .string()
    .url()
    .default("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),

  // --- Consolidation ("sleep") ---
  // A fact never reconfirmed within this many days decays to 'stale'.
  DECAY_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),
  // Episodes older than this get their raw body compressed away (kept in object store).
  RETENTION_COMPRESS_AFTER_DAYS: z.coerce.number().int().positive().default(90),
  // Episodes older than this get purged across all stores (unless raw_forever/vaulted).
  RETENTION_PURGE_AFTER_DAYS: z.coerce.number().int().positive().default(365),
  // Repeatable consolidation cadence (ms). 0 disables the scheduler.
  CONSOLIDATE_INTERVAL_MS: z.coerce.number().int().min(0).default(86_400_000),

  // --- Semantic intelligence (embedding candidate-gen + LLM adjudication) ---
  // When true (and LLM_PROVIDER=gemini), alias resolution, contradiction
  // detection, and Conductor routing use meaning, not just lexical heuristics.
  SEMANTIC_INTELLIGENCE: envBool.default(false),
  // Cosine-similarity thresholds for generating candidate pairs to adjudicate.
  ENTITY_SIM_THRESHOLD: z.coerce.number().min(0).max(1).default(0.84),
  CONTRADICTION_SIM_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  // Cap on LLM-adjudicated pairs per pass (cost control).
  SEMANTIC_MAX_PAIRS: z.coerce.number().int().positive().default(25),

  // --- Agents (Phase 3) ---
  // No contact with a person for this many days raises a relationship alert.
  RELATIONSHIP_STALE_DAYS: z.coerce.number().int().positive().default(30),
  // Repeatable Nudger cadence (ms). 0 disables the scheduler.
  NUDGER_INTERVAL_MS: z.coerce.number().int().min(0).default(0),

  // --- Auth (mobile: JWT access + rotating refresh token) ---
  JWT_SECRET: z.string().default("dev-insecure-jwt-secret-change-me"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Key material for encrypting stored OAuth tokens at rest (AES-256-GCM).
  TOKEN_ENC_KEY: z.string().default("dev-insecure-token-encryption-key"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // --- Web frontend (CORS) ---
  // Comma-separated list of browser origins allowed to call the API. In dev the
  // Next.js app (app/) uses a same-origin proxy, so this isn't exercised; set it
  // for real cross-origin / production deployments. Use "*" to allow any origin.
  WEB_ORIGIN: z.string().default("http://localhost:3001"),

  // --- Google OAuth + Gmail (create an OAuth client in Google Cloud Console) ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/auth/google/callback"),
  GMAIL_MAX_MESSAGES: z.coerce.number().int().positive().default(25),
  GMAIL_QUERY: z.string().default("newer_than:30d"),

  // --- Microsoft OAuth + Outlook (create an app registration in Entra ID) ---
  // Mail.Read / Calendars.Read / Contacts.Read via Microsoft Graph. TENANT is
  // "common" for multi-tenant + personal accounts (or a specific tenant id).
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default("common"),
  MICROSOFT_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/auth/microsoft/callback"),
  // Cap on Outlook messages pulled per ingest run.
  OUTLOOK_MAX_MESSAGES: z.coerce.number().int().positive().default(25),
  // Calendar ingestion window (days back / forward) and per-run cap.
  CALENDAR_DAYS_PAST: z.coerce.number().int().min(0).default(7),
  CALENDAR_DAYS_FUTURE: z.coerce.number().int().min(0).default(30),
  CALENDAR_MAX_EVENTS: z.coerce.number().int().positive().default(50),
  CONTACTS_MAX_RESULTS: z.coerce.number().int().positive().default(200),
  // Look-ahead window for time-triggered pre-meeting briefings (hours).
  BRIEFING_LOOKAHEAD_HOURS: z.coerce.number().int().positive().default(24),

  // --- Ingestion pacing (respect provider/embedding rate limits) ---
  // Delay between items in a run so we don't burst the embedding/API quota.
  INGEST_ITEM_DELAY_MS: z.coerce.number().int().min(0).default(250),
  // Ingest jobs processed in parallel (1 = serialize; avoids API storms).
  INGEST_CONCURRENCY: z.coerce.number().int().positive().default(1),
  // Optional BullMQ limiter: max ingest jobs per minute (0 = disabled).
  INGEST_MAX_PER_MIN: z.coerce.number().int().min(0).default(0),

  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(3000),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>>;

/**
 * Parse and validate configuration from a raw environment record.
 * Pure: pass in `process.env` (or a fixture) and get back a frozen config.
 * Throws a readable error if a required variable is missing or malformed.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return Object.freeze(result.data);
}

let cached: AppConfig | undefined;

/** Lazily parse and memoize the process configuration. */
export function getConfig(): AppConfig {
  cached ??= parseConfig();
  return cached;
}
