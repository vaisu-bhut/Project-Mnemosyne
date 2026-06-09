import type { AppConfig } from "../config/index.js";
import {
  getFirstOauthAccount,
  updateOauthTokens,
  type Db,
  type OauthAccount,
} from "../db/index.js";
import { decryptToken, encryptToken } from "./crypto.js";
import { buildOauthWebCallbackUrl } from "./handoff.js";

/**
 * Thrown when a Google account's refresh token is revoked/expired and a token
 * can no longer be obtained — the user must re-consent. Carries the account id
 * so callers can flag it.
 */
export class GoogleReauthRequiredError extends Error {
  readonly accountId: string;
  constructor(accountId: string, cause?: unknown) {
    super(`Google account ${accountId} needs re-authorization`);
    this.name = "GoogleReauthRequiredError";
    this.accountId = accountId;
    if (cause !== undefined) this.cause = cause;
  }
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// openid+email+profile for identity; gmail + calendar readonly for ingestion.
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
];

type GoogleConfig = Pick<
  AppConfig,
  "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI" | "TOKEN_ENC_KEY"
>;

function requireClient(config: GoogleConfig): { id: string; secret: string } {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Google OAuth not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    );
  }
  return { id: config.GOOGLE_CLIENT_ID, secret: config.GOOGLE_CLIENT_SECRET };
}

/**
 * Build the web hand-off URL: the SPA's OAuth callback route with the issued
 * token pair in the URL **fragment** (`#…`). The fragment is never sent to a
 * server and never appears in access logs / `Referer` headers, so the tokens
 * stay client-side; the SPA reads them with `location.hash`.
 *
 * `webOrigin` is the (possibly comma-separated) WEB_ORIGIN config; the first
 * concrete origin is used. Throws if it is unset or `"*"` — a wildcard can't be
 * a redirect target, so the web flow needs a real origin configured.
 */
export function buildWebHandoffUrl(
  webOrigin: string,
  tokens: { accessToken: string; refreshToken: string },
): string {
  return buildWebCallbackUrl(webOrigin, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
}

/**
 * Build a redirect to the SPA's Google OAuth callback with arbitrary params in
 * the URL fragment. Used for the link flow, which carries an outcome
 * (`linked=1` / `error=…`) rather than tokens.
 */
export function buildWebCallbackUrl(
  webOrigin: string,
  fragmentParams: Record<string, string>,
): string {
  return buildOauthWebCallbackUrl(webOrigin, "/auth/google/callback", fragmentParams);
}

/**
 * Build the consent URL. `state` is a signed CSRF nonce.
 *
 * `prompt=consent select_account` lets the user pick a *different* Google
 * account (required to connect a second one) and still re-issues a refresh
 * token on re-consent. `include_granted_scopes` makes re-consent incremental,
 * so granting Calendar to an account that already gave Gmail keeps Gmail.
 * `opts.loginHint` pre-targets a known account (used by "Add services").
 */
export function buildGoogleAuthUrl(
  config: GoogleConfig,
  state: string,
  opts?: { loginHint?: string },
): string {
  const { id } = requireClient(config);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // get a refresh token
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  if (opts?.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date | null;
  scope?: string;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
}

export async function exchangeCodeForTokens(
  config: GoogleConfig,
  code: string,
): Promise<GoogleTokens> {
  const { id, secret } = requireClient(config);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
    scope: json.scope,
  };
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as GoogleProfile;
}

async function refreshAccessToken(
  config: GoogleConfig,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const { id, secret } = requireClient(config);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
  };
}

/**
 * Return a valid (decrypted) Google access token for a SPECIFIC connected
 * account, refreshing and re-persisting it if it has expired (or is about to).
 * Throws `GoogleReauthRequiredError` if the refresh token is revoked/expired.
 */
export async function getValidGoogleAccessTokenForAccount(
  db: Db,
  config: GoogleConfig,
  account: OauthAccount,
): Promise<string> {
  if (!account.access_token) {
    throw new GoogleReauthRequiredError(account.id);
  }

  const notExpired =
    account.expires_at && account.expires_at.getTime() - Date.now() > 60_000;
  if (notExpired) {
    return decryptToken(account.access_token, config.TOKEN_ENC_KEY);
  }

  if (!account.refresh_token) {
    // No refresh token; hope the stored access token is still valid.
    return decryptToken(account.access_token, config.TOKEN_ENC_KEY);
  }

  let refreshed: { accessToken: string; expiresAt: Date | null };
  try {
    refreshed = await refreshAccessToken(
      config,
      decryptToken(account.refresh_token, config.TOKEN_ENC_KEY),
    );
  } catch (err) {
    // A revoked/expired refresh token (Google 400 invalid_grant) is terminal:
    // surface it as a typed re-auth signal rather than a generic failure.
    throw new GoogleReauthRequiredError(account.id, err);
  }
  await updateOauthTokens(db, account.id, {
    accessToken: encryptToken(refreshed.accessToken, config.TOKEN_ENC_KEY),
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

/**
 * Legacy/fallback resolver: a valid Google access token for the user's first
 * connected Google account. Used by sources with no explicit account binding.
 */
export async function getValidGoogleAccessToken(
  db: Db,
  config: GoogleConfig,
  userId: string,
): Promise<string> {
  const account = await getFirstOauthAccount(db, userId, "google");
  if (!account) {
    throw new Error("Google account not connected for this user");
  }
  return getValidGoogleAccessTokenForAccount(db, config, account);
}
