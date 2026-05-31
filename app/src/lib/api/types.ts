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
