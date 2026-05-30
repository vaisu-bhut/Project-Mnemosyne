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

export interface SourcesTable {
  id: Generated<string>;
  kind: string;
  display_name: string;
  scope: ColumnType<string, string | undefined, string>;
  sensitive: ColumnType<boolean, boolean | undefined, boolean>;
  config: JsonbColumn;
  created_at: Generated<Date>;
}

export interface EntitiesTable {
  id: Generated<string>;
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
  occurred_at: Timestamp;
  source_id: string;
  external_id: ColumnType<string | null, string | null | undefined, string | null>;
  kind: string;
  title: ColumnType<string | null, string | null | undefined, string | null>;
  body: ColumnType<string | null, string | null | undefined, string | null>;
  valence: ColumnType<number | null, number | null | undefined, number | null>;
  artifact_uri: ColumnType<string | null, string | null | undefined, string | null>;
  embedding: VectorColumn;
  meta: JsonbColumn;
}

export interface FactsTable {
  id: Generated<string>;
  subject_id: string;
  statement: string;
  predicate: ColumnType<string | null, string | null | undefined, string | null>;
  object_id: ColumnType<string | null, string | null | undefined, string | null>;
  confidence: ColumnType<number, number | undefined, number>;
  source_episode: string;
  source_id: string;
  learned_at: Generated<Date>;
  last_confirmed: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  reinforced: ColumnType<number, number | undefined, number>;
  contradicts: ColumnType<string | null, string | null | undefined, string | null>;
  status: ColumnType<FactStatus, FactStatus | undefined, FactStatus>;
  embedding: VectorColumn;
}

export interface EdgesTable {
  id: Generated<string>;
  src_id: string;
  dst_id: string;
  rel: string;
  props: JsonbColumn;
  created_at: Generated<Date>;
}

export interface OpenLoopsTable {
  id: Generated<string>;
  description: string;
  counterparty: ColumnType<string | null, string | null | undefined, string | null>;
  direction: LoopDirection;
  due_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  source_episode: ColumnType<string | null, string | null | undefined, string | null>;
  status: ColumnType<LoopStatus, LoopStatus | undefined, LoopStatus>;
  created_at: Generated<Date>;
}

export interface RetentionTable {
  episode_id: string;
  tier: ColumnType<RetentionTier, RetentionTier | undefined, RetentionTier>;
  compress_after: ColumnType<string | null, string | null | undefined, string | null>;
  purge_after: ColumnType<string | null, string | null | undefined, string | null>;
  vaulted: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface Database {
  sources: SourcesTable;
  entities: EntitiesTable;
  episodes: EpisodesTable;
  facts: FactsTable;
  edges: EdgesTable;
  open_loops: OpenLoopsTable;
  retention: RetentionTable;
}
