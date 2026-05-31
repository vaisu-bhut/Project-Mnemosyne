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

  // --- Generative LLM (extraction + grounded answers) ---
  // "dev"    = deterministic offline stand-in (heuristics; no network).
  // "gemini" = Gemini generateContent, reusing EMBEDDING_API_KEY (same AI Studio key).
  LLM_PROVIDER: z.enum(["dev", "gemini"]).default("dev"),
  LLM_MODEL: z.string().default("gemini-2.5-flash"),

  // --- Consolidation ("sleep") ---
  // A fact never reconfirmed within this many days decays to 'stale'.
  DECAY_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),
  // Episodes older than this get their raw body compressed away (kept in object store).
  RETENTION_COMPRESS_AFTER_DAYS: z.coerce.number().int().positive().default(90),
  // Episodes older than this get purged across all stores (unless raw_forever/vaulted).
  RETENTION_PURGE_AFTER_DAYS: z.coerce.number().int().positive().default(365),
  // Repeatable consolidation cadence (ms). 0 disables the scheduler.
  CONSOLIDATE_INTERVAL_MS: z.coerce.number().int().min(0).default(86_400_000),

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

  // --- Google OAuth + Gmail (create an OAuth client in Google Cloud Console) ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/auth/google/callback"),
  GMAIL_MAX_MESSAGES: z.coerce.number().int().positive().default(25),
  GMAIL_QUERY: z.string().default("newer_than:30d"),
  // Calendar ingestion window (days back / forward) and per-run cap.
  CALENDAR_DAYS_PAST: z.coerce.number().int().min(0).default(7),
  CALENDAR_DAYS_FUTURE: z.coerce.number().int().min(0).default(30),
  CALENDAR_MAX_EVENTS: z.coerce.number().int().positive().default(50),
  // Look-ahead window for time-triggered pre-meeting briefings (hours).
  BRIEFING_LOOKAHEAD_HOURS: z.coerce.number().int().positive().default(24),

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
