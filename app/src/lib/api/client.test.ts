import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./client";
import { clearSession, setSession } from "@/lib/auth/tokenStore";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchArgs = [string, { headers?: Record<string, string> }?];

describe("api client", () => {
  beforeEach(() => {
    clearSession();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearSession();
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    setSession({ accessToken: "old", refreshToken: "r1" });
    let refreshCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (...[url, opts]: FetchArgs) => {
        if (url.endsWith("/auth/refresh")) {
          refreshCount += 1;
          return jsonRes({ user: { id: "u" }, accessToken: "new", refreshToken: "r2" });
        }
        return opts?.headers?.Authorization === "Bearer new"
          ? jsonRes({ ok: true })
          : new Response("unauthorized", { status: 401 });
      }),
    );

    const result = await request<{ ok: boolean }>("/sources");
    expect(result).toEqual({ ok: true });
    expect(refreshCount).toBe(1);
  });

  it("shares a single refresh across concurrent 401s (single-flight)", async () => {
    setSession({ accessToken: "old", refreshToken: "r1" });
    let refreshCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (...[url, opts]: FetchArgs) => {
        if (url.endsWith("/auth/refresh")) {
          refreshCount += 1;
          return jsonRes({ user: { id: "u" }, accessToken: "new", refreshToken: "r2" });
        }
        return opts?.headers?.Authorization === "Bearer new"
          ? jsonRes({ ok: true })
          : new Response("unauthorized", { status: 401 });
      }),
    );

    const [a, b] = await Promise.all([
      request<{ ok: boolean }>("/sources"),
      request<{ ok: boolean }>("/people/health"),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCount).toBe(1);
  });

  it("does not attempt refresh without a refresh token; throws ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "authentication required" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })),
    );

    await expect(request("/sources")).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces backend validation errors with status and issues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonRes({ error: "invalid request", issues: [{ path: ["query"] }] }, 400),
      ),
    );

    await expect(request("/search", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 400,
      message: "invalid request",
    });
  });
});
