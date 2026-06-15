import type { ColumnType, Generated } from "kysely";

/** timestamptz: read as Date, write as Date or ISO string. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** A jsonb object column with a DB default (optional on insert). */
type JsonObject = Record<string, unknown>;
type JsonbColumn = ColumnType<JsonObject, JsonObject | undefined, JsonObject>;

/** text[] column with a DB default (optional on insert). */
type TextArrayColumn = ColumnType<string[], string[] | undefined, string[]>;

/**
 * pgvector column. Stored/read as the textual '[1,2,3]' representation (that's
 * what node-pg returns and accepts). Use the helpers in ./vector to convert
 * to/from number[]. Nullable + optional on insert (we don't embed yet).
 */
export type VectorColumn = ColumnType<
  string | null,
  string | null | undefined,
  string | null
>;

export type FactStatus = "active" | "stale" | "retracted";
export type LoopDirection = "i_owe" | "they_owe";
export type LoopStatus = "open" | "done" | "rotted";
export type RetentionTier = "raw_forever" | "standard" | "ephemeral";

type NullableText = ColumnType<string | null, string | null | undefined, string | null>;
type NullableDate = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: NullableText;
  display_name: NullableText;
  created_at: Generated<Date>;
}

export interface OauthAccountsTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  provider_account_id: string;
  access_token: NullableText;
  refresh_token: NullableText;
  expires_at: NullableDate;
  scope: NullableText;
  email: NullableText;
  display_name: NullableText;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  created_at: Generated<Date>;
}

export interface SourcesTable {
  id: Generated<string>;
  user_id: string;
  kind: string;
  display_name: string;
  scope: ColumnType<string, string | undefined, string>;
  config: JsonbColumn;
  oauth_account_id: NullableText;
  permissions: JsonbColumn;
  created_at: Generated<Date>;
}

export interface EntitiesTable {
  id: Generated<string>;
  user_id: string;
  type: string;
  canonical_name: string;
  aliases: TextArrayColumn;
  attrs: JsonbColumn;
  closeness: ColumnType<number | null, number | null | undefined, number | null>;
  embedding: VectorColumn;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface EpisodesTable {
  id: Generated<string>;
  user_id: string;
  occurred_at: Timestamp;
  source_id: string;
  external_id: NullableText;
  kind: string;
  title: NullableText;
  body: NullableText;
  valence: ColumnType<number | null, number | null | undefined, number | null>;
  artifact_uri: NullableText;
  embedding: VectorColumn;
  meta: JsonbColumn;
}

export interface FactsTable {
  id: Generated<string>;
  user_id: string;
  subject_id: string;
  statement: string;
  predicate: NullableText;
  object_id: NullableText;
  confidence: ColumnType<number, number | undefined, number>;
  source_episode: string;
  source_id: string;
  learned_at: Generated<Date>;
  last_confirmed: NullableDate;
  reinforced: ColumnType<number, number | undefined, number>;
  contradicts: NullableText;
  status: ColumnType<FactStatus, FactStatus | undefined, FactStatus>;
  embedding: VectorColumn;
}

export interface EdgesTable {
  id: Generated<string>;
  user_id: string;
  src_id: string;
  dst_id: string;
  rel: string;
  props: JsonbColumn;
  created_at: Generated<Date>;
}

export interface OpenLoopsTable {
  id: Generated<string>;
  user_id: string;
  description: string;
  counterparty: NullableText;
  direction: LoopDirection;
  due_at: NullableDate;
  source_episode: NullableText;
  status: ColumnType<LoopStatus, LoopStatus | undefined, LoopStatus>;
  created_at: Generated<Date>;
}

export interface RetentionTable {
  episode_id: string;
  user_id: string;
  tier: ColumnType<RetentionTier, RetentionTier | undefined, RetentionTier>;
  compress_after: NullableText;
  purge_after: NullableText;
  vaulted: ColumnType<boolean, boolean | undefined, boolean>;
}

export type BlackboardStatus = "active" | "dismissed" | "done";

export interface BlackboardTable {
  id: Generated<string>;
  user_id: string;
  kind: string;
  agent: string;
  title: string;
  body: NullableText;
  entity_id: NullableText;
  salience: ColumnType<number, number | undefined, number>;
  payload: JsonbColumn;
  status: ColumnType<BlackboardStatus, BlackboardStatus | undefined, BlackboardStatus>;
  created_at: Generated<Date>;
  expires_at: NullableDate;
}

export interface NudgeSnoozesTable {
  user_id: string;
  nudge_key: string;
  snoozed_until: Date;
}

export type IngestRunStatus = "queued" | "running" | "done" | "error";

/** A compact sample of a recently-ingested item (stored in ingest_runs.items). */
export interface IngestRunItemRow {
  title: string | null;
  kind: string;
}

export interface IngestRunsTable {
  id: Generated<string>;
  user_id: string;
  source_id: string;
  status: ColumnType<IngestRunStatus, IngestRunStatus | undefined, IngestRunStatus>;
  ingested: ColumnType<number, number | undefined, number>;
  total: ColumnType<number | null, number | null | undefined, number | null>;
  // jsonb array: read as a parsed array; written as a JSON string (pg serializes
  // plain JS arrays as Postgres array literals, not jsonb, so we stringify).
  items: ColumnType<IngestRunItemRow[], string | undefined, string>;
  error: NullableText;
  started_at: Generated<Date>;
  finished_at: NullableDate;
}

export interface Database {
  users: UsersTable;
  oauth_accounts: OauthAccountsTable;
  sessions: SessionsTable;
  sources: SourcesTable;
  entities: EntitiesTable;
  episodes: EpisodesTable;
  facts: FactsTable;
  edges: EdgesTable;
  open_loops: OpenLoopsTable;
  retention: RetentionTable;
  blackboard: BlackboardTable;
  nudge_snoozes: NudgeSnoozesTable;
  ingest_runs: IngestRunsTable;
}
