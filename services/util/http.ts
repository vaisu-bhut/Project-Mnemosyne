/** Resolve after `ms` (no-op for <= 0). */
export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export interface RetryOptions {
  /** Injectable fetch (for tests); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

/**
 * fetch with bounded exponential backoff on rate-limit / transient errors
 * (HTTP 429, 503), honoring `Retry-After`. Non-429/503 responses (incl. other
 * errors like 404) are returned immediately for the caller to handle. Lets
 * ingestion ride out provider rate limits instead of failing the whole run.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 5;
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch(url, init);
    if ((res.status !== 429 && res.status !== 503) || attempt >= maxAttempts) {
      return res;
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** (attempt - 1), 8000);
    await sleep(delayMs);
  }
}
