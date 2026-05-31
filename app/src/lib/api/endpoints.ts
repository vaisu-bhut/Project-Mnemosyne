import { request } from "./client";
import { camelize } from "./casing";
import type {
  AuthResponse,
  AuthUser,
  ClassifySourceInput,
  CreateSourceInput,
  Source,
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
  googleUrl: () => request<{ url: string }>("/auth/google/url"),
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
