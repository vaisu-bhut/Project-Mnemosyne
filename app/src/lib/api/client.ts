import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
} from "@/lib/auth/tokenStore";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

/** Error thrown for any non-2xx API response. Carries the HTTP status and any
 * Zod validation issues the backend returned ({error, issues}). */
export class ApiError extends Error {
  readonly status: number;
  readonly issues?: unknown;
  constructor(status: number, message: string, issues?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

// Auth endpoints that must never trigger the 401 -> refresh -> retry loop
// (refresh recursing on itself; login/register/logout 401s are terminal).
const NO_REFRESH_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
]);

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function rawFetch(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
}

// Single-flight refresh: concurrent 401s share one /auth/refresh call so the
// rotating refresh token is consumed exactly once.
let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
      const res = await fetch(buildUrl("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearSession();
        return null;
      }
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return data.accessToken;
    } catch {
      clearSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || "request failed";
  let issues: unknown;
  try {
    const data = (await res.json()) as { error?: string; issues?: unknown };
    if (data?.error) message = data.error;
    issues = data?.issues;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, message, issues);
}

/** Typed JSON request with automatic bearer auth and refresh-on-401 retry. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(path, opts);

  if (res.status === 401 && !NO_REFRESH_PATHS.has(path) && getRefreshToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await rawFetch(path, opts);
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
