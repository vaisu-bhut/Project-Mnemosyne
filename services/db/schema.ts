import pg from "pg";

/**
 * Declarative schema for Project Mnemosyne.
 *
 * While we're still building (no data, no production deploy), we keep one
 * authoritative schema and recreate it with `resetSchema` instead of carrying a
 * stack of incremental migrations. Edit this file, run `pnpm db:reset`. When the
 * product has real data to preserve, reintroduce a migration tool.
 *
 * Design notes:
 *   * Single Postgres + pgvector DB for everything (pgvector only — maps onto
 *     AWS Aurora later; no Apache AGE / TimescaleDB).
 *   * The graph is plain relational edge tables (`edges`).
 *   * `episodes` is natively RANGE-partitioned by month on `occurred_at`.
 *   * Provenance is mandatory on `facts` (source_episode + source_id NOT NULL).
 */
export function buildSchemaSql(vectorDim: number): string {
  if (!Number.isInteger(vectorDim) || vectorDim <= 0) {
    throw new Error(`Invalid vectorDim: ${vectorDim}`);
  }

  return `
-- Drop existing objects so this is a clean, idempotent reset.
DROP TABLE IF EXISTS blackboard CASCADE;
DROP TABLE IF EXISTS retention CASCADE;
DROP TABLE IF EXISTS open_loops CASCADE;
DROP TABLE IF EXISTS edges CASCADE;
DROP TABLE IF EXISTS facts CASCADE;
DROP TABLE IF EXISTS episodes CASCADE;
DROP FUNCTION IF EXISTS create_episodes_partition(date);
DROP TABLE IF EXISTS entities CASCADE;
DROP TABLE IF EXISTS sources CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS oauth_accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE EXTENSION IF NOT EXISTS vector;

-- users: the owner of everything. Every memory row carries user_id; a user
-- owns their entire graph, and nothing crosses the boundary.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text,             -- null for OAuth-only accounts
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- oauth_accounts: linked external identities + tokens (encrypted at rest).
CREATE TABLE oauth_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  access_token        text,   -- AES-256-GCM ciphertext
  refresh_token       text,   -- AES-256-GCM ciphertext
  expires_at          timestamptz,
  scope               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);
CREATE INDEX oauth_accounts_user_idx ON oauth_accounts (user_id, provider);

-- sessions: refresh tokens (only their SHA-256 hash is stored). Rotated on use.
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- sources: a connector (gmail, calendar, ...) owned by a user.
CREATE TABLE sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  display_name text NOT NULL,
  scope        text NOT NULL DEFAULT 'personal',
  sensitive    boolean NOT NULL DEFAULT false,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sources_user_idx ON sources (user_id);

-- entities: graph nodes (person/place/org/project)
CREATE TABLE entities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           text NOT NULL,
  canonical_name text NOT NULL,
  aliases        text[] NOT NULL DEFAULT '{}',
  attrs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  closeness      real,
  embedding      vector(${vectorDim}),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entities_user_type_idx ON entities (user_id, type);
CREATE INDEX entities_aliases_gin ON entities USING gin (aliases);
CREATE INDEX entities_embedding_hnsw ON entities USING hnsw (embedding vector_cosine_ops);

-- episodes: timestamped events, monthly-partitioned by occurred_at.
-- Native partitioning requires the partition key in every unique constraint,
-- so PK is (id, occurred_at) and the ingestion-dedup unique is
-- (source_id, external_id, occurred_at).
CREATE TABLE episodes (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL,
  source_id    uuid NOT NULL REFERENCES sources(id),
  external_id  text,
  kind         text NOT NULL,
  title        text,
  body         text,
  valence      real,
  artifact_uri text,
  embedding    vector(${vectorDim}),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE UNIQUE INDEX episodes_source_external_uidx
  ON episodes (source_id, external_id, occurred_at);
CREATE INDEX episodes_user_idx ON episodes (user_id);
CREATE INDEX episodes_embedding_hnsw ON episodes USING hnsw (embedding vector_cosine_ops);

-- Helper: create a monthly partition (idempotent). Callable to roll forward.
CREATE OR REPLACE FUNCTION create_episodes_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  start_date date := date_trunc('month', p_month)::date;
  end_date   date := (date_trunc('month', p_month) + interval '1 month')::date;
  part_name  text := 'episodes_' || to_char(start_date, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF episodes FOR VALUES FROM (%L) TO (%L)',
      part_name, start_date, end_date
    );
  END IF;
END;
$fn$;

-- Pre-create current month +/- 3 months.
DO $$
DECLARE m int;
BEGIN
  FOR m IN -3..3 LOOP
    PERFORM create_episodes_partition(
      (date_trunc('month', now()) + (m || ' month')::interval)::date
    );
  END LOOP;
END $$;

-- DEFAULT partition catches out-of-range occurred_at so inserts never fail in
-- dev. In production, pre-create monthly partitions and keep the default empty.
CREATE TABLE episodes_default PARTITION OF episodes DEFAULT;

-- facts: semantic memory with mandatory provenance + trust
CREATE TABLE facts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id     uuid NOT NULL REFERENCES entities(id),
  statement      text NOT NULL,
  predicate      text,
  object_id      uuid REFERENCES entities(id),
  confidence     real NOT NULL DEFAULT 0.5,
  source_episode uuid NOT NULL,
  source_id      uuid NOT NULL REFERENCES sources(id),
  learned_at     timestamptz NOT NULL DEFAULT now(),
  last_confirmed timestamptz,
  reinforced     integer NOT NULL DEFAULT 1,
  contradicts    uuid REFERENCES facts(id),
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'stale', 'retracted')),
  embedding      vector(${vectorDim})
);
CREATE INDEX facts_user_subject_idx ON facts (user_id, subject_id);
CREATE INDEX facts_user_status_idx ON facts (user_id, status);
CREATE INDEX facts_embedding_hnsw ON facts USING hnsw (embedding vector_cosine_ops);

-- edges: canonical graph (entity<->entity / entity<->episode).
-- src_id/dst_id are intentionally not FKs (may reference entities or the
-- partitioned episodes table).
CREATE TABLE edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  src_id     uuid NOT NULL,
  dst_id     uuid NOT NULL,
  rel        text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX edges_src_rel_idx ON edges (user_id, src_id, rel);
CREATE INDEX edges_dst_rel_idx ON edges (user_id, dst_id, rel);

-- open_loops: prospective memory / promises
CREATE TABLE open_loops (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description    text NOT NULL,
  counterparty   uuid REFERENCES entities(id),
  direction      text NOT NULL CHECK (direction IN ('i_owe', 'they_owe')),
  due_at         timestamptz,
  source_episode uuid,
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'done', 'rotted')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX open_loops_user_idx ON open_loops (user_id, status);

-- retention: tiered forgetting policy (episode_id is a bare uuid PK, not a FK,
-- for the same partitioned-PK reason as edges).
CREATE TABLE retention (
  episode_id     uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier           text NOT NULL DEFAULT 'standard'
                   CHECK (tier IN ('raw_forever', 'standard', 'ephemeral')),
  compress_after interval,
  purge_after    interval,
  vaulted        boolean NOT NULL DEFAULT false
);
CREATE INDEX retention_user_idx ON retention (user_id);

-- blackboard: shared WORKING MEMORY for the agent mesh. Agents write entries
-- (nudges, alerts, briefings, questions); "what's on my mind" reads the most
-- salient active ones. Observable and stoppable by design.
CREATE TABLE blackboard (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  agent      text NOT NULL,
  title      text NOT NULL,
  body       text,
  entity_id  uuid REFERENCES entities(id) ON DELETE CASCADE,
  salience   real NOT NULL DEFAULT 0.5,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status     text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'dismissed', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX blackboard_salience_idx ON blackboard (user_id, status, salience DESC);
CREATE INDEX blackboard_entity_idx ON blackboard (entity_id);
`;
}

/**
 * Drop and recreate the entire schema against the given database.
 * Destructive — intended for the build phase and tests only.
 */
export async function resetSchema(
  connectionString: string,
  vectorDim: number,
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(buildSchemaSql(vectorDim));
  } finally {
    await client.end();
  }
}
