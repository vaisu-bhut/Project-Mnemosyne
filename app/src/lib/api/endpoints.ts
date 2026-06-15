import { request } from "./client";
import { camelize } from "./casing";
import type {
  Account,
  Answer,
  AskInput,
  AuthResponse,
  AuthUser,
  BlackboardEntry,
  Briefing,
  ClassifySourceInput,
  ConsolidationReport,
  Contradiction,
  CreateSourceInput,
  Episode,
  EpisodeTrace,
  Fact,
  HealthStatus,
  IngestRun,
  ListEpisodesParams,
  ListFactsParams,
  LoopStatus,
  UpdateFactInput,
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
  // mode=web => the callback redirects back to the SPA (see app/auth/google/callback)
  // rather than returning JSON. intent=link attaches the account to the logged-in
  // user (sends the Bearer token); loginHint pre-targets an account ("Add services").
  googleUrl: (opts: { intent?: "signin" | "link"; loginHint?: string } = {}) =>
    request<{ url: string }>("/auth/google/url", {
      query: {
        mode: "web",
        ...(opts.intent ? { intent: opts.intent } : {}),
        ...(opts.loginHint ? { loginHint: opts.loginHint } : {}),
      },
    }),
  microsoftUrl: (opts: { intent?: "signin" | "link"; loginHint?: string } = {}) =>
    request<{ url: string }>("/auth/microsoft/url", {
      query: {
        mode: "web",
        ...(opts.intent ? { intent: opts.intent } : {}),
        ...(opts.loginHint ? { loginHint: opts.loginHint } : {}),
      },
    }),
};

// Connected OAuth accounts. /accounts emits camelCase (with computed services[]),
// so no client-side camelize is needed (unlike /sources).
export const accountsApi = {
  list: () => request<Account[]>("/accounts"),
  disconnect: (id: string) => request<void>(`/accounts/${id}`, { method: "DELETE" }),
};

// /sources returns raw DB rows (snake_case) — camelize into Source.
export const sourcesApi = {
  list: async (): Promise<Source[]> => camelize<Source[]>(await request("/sources")),
  create: async (input: CreateSourceInput): Promise<Source> =>
    camelize<Source>(await request("/sources", { method: "POST", body: input })),
  classify: async (id: string, input: ClassifySourceInput): Promise<Source> =>
    camelize<Source>(await request(`/sources/${id}`, { method: "PATCH", body: input })),
  ingest: (id: string) =>
    request<{ jobId: string; sourceId: string; runId: string }>(`/sources/${id}/ingest`, {
      method: "POST",
      body: {},
    }),
  ingestStatus: (id: string) => request<IngestRun>(`/sources/${id}/ingest-status`),
};

// /episodes and /facts emit camelCase (server-mapped) — no client camelize.
export const episodesApi = {
  list: (params: ListEpisodesParams = {}) =>
    request<Episode[]>("/episodes", {
      query: {
        limit: params.limit,
        offset: params.offset,
        kind: params.kind,
        sourceId: params.sourceId,
        mode: params.mode,
        includeSensitive: params.includeSensitive,
      },
    }),
  // The extraction trace: source episode + the facts derived from it.
  trace: (id: string, opts: { mode?: Mode; includeSensitive?: boolean } = {}) =>
    request<EpisodeTrace>(`/episodes/${id}/trace`, {
      query: { mode: opts.mode, includeSensitive: opts.includeSensitive },
    }),
};
export const factsApi = {
  update: (id: string, input: UpdateFactInput) =>
    request<Fact>(`/facts/${id}`, { method: "PATCH", body: input }),
  remove: (id: string) => request<void>(`/facts/${id}`, { method: "DELETE" }),
  list: (params: ListFactsParams = {}) =>
    request<Fact[]>("/facts", {
      query: {
        limit: params.limit,
        offset: params.offset,
        status: params.status,
        subjectId: params.subjectId,
        mode: params.mode,
        includeSensitive: params.includeSensitive,
      },
    }),
};

export const memoryApi = {
  search: (query: string, opts: RetrieveInput = {}) =>
    request<SearchResult>("/search", { method: "POST", body: { query, ...opts } }),
  ask: (question: string, opts: AskInput = {}) =>
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
