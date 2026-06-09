/**
 * Shared OAuth web hand-off helper. After the browser-initiated ("web") OAuth
 * flow, the backend 302-redirects to the SPA's callback route with the outcome
 * in the URL *fragment* (`#…`) — never the query string — so tokens/outcomes
 * stay client-side (out of server logs and Referer headers).
 *
 * `webOrigin` is the (possibly comma-separated) WEB_ORIGIN config; the first
 * concrete origin is used. Throws if it is unset or "*" — a wildcard can't be a
 * redirect target.
 */
export function buildOauthWebCallbackUrl(
  webOrigin: string,
  callbackPath: string,
  fragmentParams: Record<string, string>,
): string {
  const origin = webOrigin.split(",")[0]?.trim().replace(/\/+$/, "") ?? "";
  if (!origin || origin === "*") {
    throw new Error(
      "Web OAuth hand-off requires a concrete WEB_ORIGIN (not empty or '*')",
    );
  }
  const fragment = new URLSearchParams(fragmentParams).toString();
  return `${origin}${callbackPath}#${fragment}`;
}
