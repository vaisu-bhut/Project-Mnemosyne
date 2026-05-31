/**
 * A connector is a source of raw items (one MCP server per source, later).
 * The contract is deliberately small: pull a batch of items (optionally
 * incrementally from a cursor); the pipeline handles storage, dedup, episode
 * creation, participant linking, and extraction.
 */

/** A person involved in an item (e.g. an email sender/recipient). */
export interface Participant {
  email?: string;
  name?: string;
  role: "from" | "to" | "cc" | "other";
}

/** A binary attachment carried by an item. */
export interface Attachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

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
  /** Structured people on this item (headers etc.) — seeds the People graph. */
  participants?: Participant[];
  attachments?: Attachment[];
  meta?: Record<string, unknown>;
}

export interface PullOptions {
  /** Opaque per-source cursor from the previous run (e.g. a Gmail historyId). */
  cursor?: string | null;
}

export interface PullResult {
  items: RawItem[];
  /** New cursor to persist for the next incremental run (if supported). */
  cursor?: string | null;
}

export interface Connector {
  readonly name: string;
  pull(opts?: PullOptions): Promise<PullResult>;
}
