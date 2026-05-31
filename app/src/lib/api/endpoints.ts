import { request } from "./client";
import { camelize } from "./casing";
import type {
  Answer,
  AuthResponse,
  AuthUser,
  BlackboardEntry,
  Briefing,
  ClassifySourceInput,
  ConsolidationReport,
  Contradiction,
  CreateSourceInput,
  HealthStatus,
  LoopStatus,
  Mode,
  NudgerResult,
  OpenLoop,
  RelationshipHealth,
  RetentionInput,
  RetrieveInput,
  RouteResult,
  SearchResult,
  Source,
  SummarizeResult,
  UpcomingBriefing,
} from "./types";

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const authApi = {
  register: (input: RegisterInput) =>
    request<AuthResponse>("/auth/register", { method: "POST", body: input }),
  login: (input: LoginInput) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: input }),
  logout: (refreshToken: string) =>
    request<void>("/auth/logout", { method: "POST", body: { refreshToken } }),
  me: () => request<{ user: AuthUser }>("/auth/me"),
  // mode=web => the callback redirects back to the SPA with the token pair in
  // the URL fragment (see app/auth/google/callback), rather than returning JSON.
  googleUrl: () => request<{ url: string }>("/auth/google/url", { query: { mode: "web" } }),
};

// /sources returns raw DB rows (snake_case) — camelize into Source.
export const sourcesApi = {
  list: async (): Promise<Source[]> => camelize<Source[]>(await request("/sources")),
  create: async (input: CreateSourceInput): Promise<Source> =>
    camelize<Source>(await request("/sources", { method: "POST", body: input })),
  classify: async (id: string, input: ClassifySourceInput): Promise<Source> =>
    camelize<Source>(await request(`/sources/${id}`, { method: "PATCH", body: input })),
  ingest: (id: string) =>
    request<{ jobId: string; sourceId: string }>(`/sources/${id}/ingest`, {
      method: "POST",
      body: {},
    }),
};

export const memoryApi = {
  search: (query: string, opts: RetrieveInput = {}) =>
    request<SearchResult>("/search", { method: "POST", body: { query, ...opts } }),
  ask: (question: string, opts: RetrieveInput = {}) =>
    request<Answer>("/ask", { method: "POST", body: { question, ...opts } }),
  forget: (episodeId: string) =>
    request<{ artifactDeleted: boolean }>(`/episodes/${episodeId}/forget`, {
      method: "POST",
      body: {},
    }),
  setRetention: ({ episodeId, ...policy }: RetentionInput) =>
    request<void>("/retention", { method: "POST", body: { episodeId, ...policy } }),
};

export const agentsApi = {
  // /mind returns raw blackboard rows (snake_case).
  mind: async (k = 10): Promise<BlackboardEntry[]> =>
    camelize<BlackboardEntry[]>(await request("/mind", { query: { k } })),
  dismiss: (id: string) =>
    request<void>(`/blackboard/${id}/dismiss`, { method: "POST", body: {} }),
  runNudger: () => request<NudgerResult>("/agents/nudger/run", { method: "POST", body: {} }),
  conduct: (query: string, opts: { mode?: Mode; includeSensitive?: boolean } = {}) =>
    request<RouteResult>("/conduct", { method: "POST", body: { query, ...opts } }),
};

export const peopleApi = {
  health: () => request<RelationshipHealth[]>("/people/health"),
  brief: (id: string) => request<Briefing>(`/people/${id}/brief`),
};

export const briefingsApi = {
  upcoming: (hours = 24) =>
    request<UpcomingBriefing[]>("/briefings/upcoming", { query: { hours } }),
};

export const openLoopsApi = {
  // /open-loops returns raw rows (snake_case).
  list: async (status?: LoopStatus): Promise<OpenLoop[]> =>
    camelize<OpenLoop[]>(await request("/open-loops", { query: { status } })),
};

export const adminApi = {
  consolidate: () =>
    request<ConsolidationReport>("/consolidate", { method: "POST", body: {} }),
  // /contradictions rows are already camelCase (aliased server-side).
  contradictions: () => request<Contradiction[]>("/contradictions"),
  summarizeEntity: (id: string) =>
    request<SummarizeResult>(`/entities/${id}/summarize`, { method: "POST", body: {} }),
  health: () => request<HealthStatus>("/health"),
};
