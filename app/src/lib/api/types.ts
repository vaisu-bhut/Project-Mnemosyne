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

export type SourceKind =
  | "filesystem"
  | "gmail"
  | "gcal"
  | "gcontacts"
  | "msmail"
  | "mscal"
  | "mscontacts";

export type OAuthProvider = "google" | "microsoft";

/** Per-app permission definitions. Only `read` is enforced today (ingestion);
 * `write`/`delete` are declarations for the future write/action layer.
 * "delete" = deleting data at the source (email, note), never memory. */
export interface SourcePermissions {
  read: boolean;
  write: boolean;
  delete: boolean;
  mode: "autonomous" | "approval";
}

export const DEFAULT_PERMISSIONS: SourcePermissions = {
  read: true,
  write: false,
  delete: false,
  mode: "approval",
};

/** A connector/source. Raw DB row (snake_case) camelized client-side. */
export interface Source {
  id: string;
  userId: string;
  kind: SourceKind;
  displayName: string;
  scope: string;
  sensitive: boolean;
  config: Record<string, unknown> | null;
  oauthAccountId: string | null;
  permissions: SourcePermissions;
  createdAt: string;
}

export interface CreateSourceInput {
  kind: SourceKind;
  displayName: string;
  scope?: string;
  sensitive?: boolean;
  config?: Record<string, unknown>;
  /** For OAuth-backed kinds: which connected account this source pulls from. */
  oauthAccountId?: string;
  permissions?: SourcePermissions;
}

// --- Connected accounts (BACKEND.md §6; /accounts is camelCase) ---

export interface ServiceInfo {
  key: "gmail" | "mail" | "calendar" | "contacts" | "identity";
  label: string;
}

/** A connected OAuth account + the services it granted. Never carries tokens. */
export interface Account {
  id: string;
  provider: OAuthProvider;
  email: string | null;
  displayName: string | null;
  providerAccountId: string;
  services: ServiceInfo[];
  scopeRaw: string | null;
  expiresAt: string | null;
  needsReauth: boolean;
}

export interface ClassifySourceInput {
  scope?: string;
  sensitive?: boolean;
  permissions?: SourcePermissions;
}

export interface UpdateFactInput {
  statement?: string;
  status?: FactStatus;
}

export type IngestRunStatus = "queued" | "running" | "done" | "error";

export interface IngestRunItem {
  title: string | null;
  kind: string;
}

/** Live status of an ingestion run (GET /sources/:id/ingest-status, camelCase). */
export interface IngestRun {
  id: string;
  sourceId: string;
  status: IngestRunStatus;
  ingested: number;
  total: number | null;
  items: IngestRunItem[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
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

// --- Page-context chat ("ask your brain") ---

/** Biases retrieval to a page's data (a person, a source, an episode kind). */
export interface ChatScope {
  entityId?: string;
  sourceId?: string;
  kind?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskInput extends RetrieveInput {
  scope?: ChatScope;
  history?: ChatMessage[];
}

// --- Episodes & Facts browsers (GET /episodes, /facts; camelCase) ---

export interface Episode {
  id: string;
  occurredAt: string;
  kind: string;
  title: string | null;
  sourceId: string;
  snippet: string | null;
  artifactUri: string | null;
}

export type FactStatus = "active" | "stale" | "retracted";

export interface Fact {
  id: string;
  statement: string;
  predicate: string | null;
  subjectId: string;
  objectId: string | null;
  status: FactStatus;
  reinforced: number;
  confidence: number;
  sourceEpisode: string;
  sourceId: string;
  contradicts: string | null;
  learnedAt: string;
}

export interface ListEpisodesParams {
  limit?: number;
  offset?: number;
  kind?: string;
  sourceId?: string;
  mode?: Mode;
  includeSensitive?: boolean;
}

export interface ListFactsParams {
  limit?: number;
  offset?: number;
  status?: FactStatus;
  subjectId?: string;
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
