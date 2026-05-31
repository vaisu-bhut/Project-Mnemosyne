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

// --- Agent mesh (BACKEND.md §6) ---

export type LoopDirection = "i_owe" | "they_owe";
export type LoopStatus = "open" | "done" | "rotted";
export type BlackboardStatus = "active" | "dismissed" | "done";

/** /mind row (raw snake_case, camelized client-side). */
export interface BlackboardEntry {
  id: string;
  userId: string;
  kind: string;
  agent: string;
  title: string;
  body: string | null;
  entityId: string | null;
  salience: number;
  payload: Record<string, unknown> | null;
  status: BlackboardStatus;
  createdAt: string;
  expiresAt: string | null;
}

/** /open-loops row (raw snake_case, camelized client-side). */
export interface OpenLoop {
  id: string;
  userId: string;
  description: string;
  counterparty: string | null;
  direction: LoopDirection;
  dueAt: string | null;
  sourceEpisode: string | null;
  status: LoopStatus;
  createdAt: string;
}

export interface OpenThread {
  id: string;
  description: string;
  direction: string;
}

export interface RelationshipHealth {
  entityId: string;
  name: string;
  closeness: number | null;
  interactions: number;
  lastContactAt: string | null;
  daysSinceContact: number | null;
  openThreads: OpenThread[];
}

export interface RelationshipAlert {
  entityId: string;
  name: string;
  daysSinceContact: number;
}

export interface BriefInteraction {
  episodeId: string;
  title: string | null;
  occurredAt: string;
  snippet: string | null;
}

export interface BriefFact {
  statement: string;
  episodeId: string;
}

export interface Briefing {
  entityId: string;
  name: string;
  aliases: string[];
  summary: string | null;
  closeness: number | null;
  lastContactAt: string | null;
  daysSinceContact: number | null;
  interactions: number;
  recentInteractions: BriefInteraction[];
  openThreads: OpenThread[];
  recentFacts: BriefFact[];
  suggestedQuestions: string[];
}

export interface UpcomingBriefing {
  eventId: string;
  eventTitle: string | null;
  eventStart: string;
  briefing: Briefing;
}

export interface NudgerResult {
  openLoopNudges: number;
  relationshipAlerts: number;
  total: number;
}

export type Intent = "recall" | "briefing" | "people" | "nudges";

export interface RouteResult {
  intent: Intent;
  via: string;
  result: unknown;
}

// --- Admin / consolidation (BACKEND.md §6) ---

export interface ConsolidationReport {
  entitiesMerged: number;
  factsRetracted: number;
  contradictionsLinked: number;
  factsStaled: number;
  episodesCompressed: number;
  episodesPurged: number;
}

/** /contradictions rows are already aliased to camelCase server-side. */
export interface Contradiction {
  id: string;
  statement: string;
  episode: string | null;
  contradictsId: string;
  contradictsStatement: string;
}

export interface SummarizeResult {
  id: string;
  summary: string | null;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  checks: { database: boolean; redis: boolean; storage: boolean };
}
