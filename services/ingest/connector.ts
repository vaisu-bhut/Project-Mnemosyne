/**
 * A connector is a source of raw items (one MCP server per source, later).
 * The contract is deliberately small: pull a batch of items; the pipeline
 * handles storage, dedup, episode creation, and extraction.
 */
export interface RawItem {
  /** Stable id within the source; used for ingestion dedup. */
  externalId: string;
  occurredAt: Date;
  kind: string;
  title?: string | null;
  body: string;
  /** Raw payload to persist in the artifact store. */
  raw: Buffer;
  contentType: string;
  meta?: Record<string, unknown>;
}

export interface PullResult {
  items: RawItem[];
}

export interface Connector {
  readonly name: string;
  pull(): Promise<PullResult>;
}
