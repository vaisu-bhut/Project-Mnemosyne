/**
 * Types mirroring the backend HTTP API (BACKEND.md §6). Auth + computed
 * endpoints are camelCase; raw DB-row endpoints (added in later phases) are
 * snake_case and normalized via ./casing.
 */

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

/** register / login / refresh / google-callback all return this shape. */
export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export type SourceKind = "filesystem" | "gmail" | "gcal" | "gcontacts";

/** A connector/source. Raw DB row (snake_case) camelized client-side. */
export interface Source {
  id: string;
  userId: string;
  kind: SourceKind;
  displayName: string;
  scope: string;
  sensitive: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateSourceInput {
  kind: SourceKind;
  displayName: string;
  scope?: string;
  sensitive?: boolean;
  config?: Record<string, unknown>;
}

export interface ClassifySourceInput {
  scope?: string;
  sensitive?: boolean;
}

// --- Retrieval (BACKEND.md §6; /search and /ask are camelCase) ---

export type Mode = "default" | "work" | "guest";

/** The "verify on click" anchor back to a claim's source. */
export interface Citation {
  episodeId: string | null;
  sourceId: string | null;
}

export interface FactHit {
  id: string;
  statement: string;
  confidence: number;
  distance: number;
  citation: Citation;
}

export interface EpisodeHit {
  id: string;
  title: string | null;
  snippet: string | null;
  occurredAt: string;
  distance: number;
  citation: Citation;
}

export interface EntityHit {
  id: string;
  canonicalName: string;
  type: string;
  distance: number;
}

export interface SearchResult {
  facts: FactHit[];
  episodes: EpisodeHit[];
  entities: EntityHit[];
}

export interface Answer {
  answer: string;
  citations: Citation[];
  used: { facts: FactHit[]; episodes: EpisodeHit[] };
}

export interface RetrieveInput {
  k?: number;
  mode?: Mode;
  includeSensitive?: boolean;
}

export type RetentionTier = "raw_forever" | "standard" | "ephemeral";

export interface RetentionInput {
  episodeId: string;
  tier?: RetentionTier;
  compressAfter?: string;
  purgeAfter?: string;
  vaulted?: boolean;
}
