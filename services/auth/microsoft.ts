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
 * Thrown when a Microsoft account's refresh token is revoked/expired and a
 * token can no longer be obtained — the user must re-consent.
 */
export class MicrosoftReauthRequiredError extends Error {
  readonly accountId: string;
  constructor(accountId: string, cause?: unknown) {
    super(`Microsoft account ${accountId} needs re-authorization`);
    this.name = "MicrosoftReauthRequiredError";
    this.accountId = accountId;
    if (cause !== undefined) this.cause = cause;
  }
}

const GRAPH_ME = "https://graph.microsoft.com/v1.0/me";

// openid+email+profile for identity; offline_access for a refresh token;
// User.Read + Mail/Calendars/Contacts.Read for ingestion.
const SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Calendars.Read",
  "Contacts.Read",
];

type MicrosoftConfig = Pick<
  AppConfig,
  | "MICROSOFT_CLIENT_ID"
  | "MICROSOFT_CLIENT_SECRET"
  | "MICROSOFT_REDIRECT_URI"
  | "MICROSOFT_TENANT"
  | "TOKEN_ENC_KEY"
>;

function authBase(config: MicrosoftConfig): string {
  return `https://login.microsoftonline.com/${config.MICROSOFT_TENANT}/oauth2/v2.0`;
}

function requireClient(config: MicrosoftConfig): { id: string; secret: string } {
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) {
    throw new Error(
      "Microsoft OAuth not configured — set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET",
    );
  }
  return { id: config.MICROSOFT_CLIENT_ID, secret: config.MICROSOFT_CLIENT_SECRET };
}

/** Build the web hand-off URL to the SPA's Microsoft OAuth callback route. */
export function buildMicrosoftHandoffUrl(
  webOrigin: string,
  tokens: { accessToken: string; refreshToken: string },
): string {
  return buildMicrosoftWebCallbackUrl(webOrigin, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
}

/** Redirect to the SPA's Microsoft callback with arbitrary fragment params. */
export function buildMicrosoftWebCallbackUrl(
  webOrigin: string,
  fragmentParams: Record<string, string>,
): string {
  return buildOauthWebCallbackUrl(webOrigin, "/auth/microsoft/callback", fragmentParams);
}

/**
 * Build the consent URL. `state` is a signed CSRF nonce. `prompt=select_account`
 * lets the user pick a different Microsoft account (required to add a second).
 * `opts.loginHint` pre-targets a known account (used by "Add services").
 */
export function buildMicrosoftAuthUrl(
  config: MicrosoftConfig,
  state: string,
  opts?: { loginHint?: string },
): string {
  const { id } = requireClient(config);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: config.MICROSOFT_REDIRECT_URI,
    response_type: "code",
    response_mode: "query",
    scope: SCOPES.join(" "),
    prompt: "select_account",
    state,
  });
  if (opts?.loginHint) params.set("login_hint", opts.loginHint);
  return `${authBase(config)}/authorize?${params.toString()}`;
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date | null;
  scope?: string;
}

export interface MicrosoftProfile {
  id: string;
  email: string;
  name?: string;
}

export async function exchangeCodeForTokens(
  config: MicrosoftConfig,
  code: string,
): Promise<MicrosoftTokens> {
  const { id, secret } = requireClient(config);
  const res = await fetch(`${authBase(config)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: config.MICROSOFT_REDIRECT_URI,
      grant_type: "authorization_code",
      scope: SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token exchange failed (${res.status}): ${await res.text()}`);
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

export async function fetchMicrosoftProfile(accessToken: string): Promise<MicrosoftProfile> {
  const res = await fetch(GRAPH_ME, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Microsoft profile fetch failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    id: string;
    displayName?: string;
    mail?: string | null;
    userPrincipalName?: string;
  };
  return {
    id: json.id,
    email: (json.mail ?? json.userPrincipalName ?? "").toLowerCase(),
    name: json.displayName,
  };
}

async function refreshAccessToken(
  config: MicrosoftConfig,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date | null }> {
  const { id, secret } = requireClient(config);
  const res = await fetch(`${authBase(config)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
  };
}

/**
 * Return a valid (decrypted) Microsoft access token for a SPECIFIC connected
 * account, refreshing and re-persisting it if expired. Throws
 * `MicrosoftReauthRequiredError` if the refresh token is revoked/expired.
 * Microsoft rotates refresh tokens, so a new one is persisted when returned.
 */
export async function getValidMicrosoftAccessTokenForAccount(
  db: Db,
  config: MicrosoftConfig,
  account: OauthAccount,
): Promise<string> {
  if (!account.access_token) {
    throw new MicrosoftReauthRequiredError(account.id);
  }

  const notExpired =
    account.expires_at && account.expires_at.getTime() - Date.now() > 60_000;
  if (notExpired) {
    return decryptToken(account.access_token, config.TOKEN_ENC_KEY);
  }

  if (!account.refresh_token) {
    return decryptToken(account.access_token, config.TOKEN_ENC_KEY);
  }

  let refreshed: { accessToken: string; refreshToken?: string; expiresAt: Date | null };
  try {
    refreshed = await refreshAccessToken(
      config,
      decryptToken(account.refresh_token, config.TOKEN_ENC_KEY),
    );
  } catch (err) {
    throw new MicrosoftReauthRequiredError(account.id, err);
  }
  await updateOauthTokens(db, account.id, {
    accessToken: encryptToken(refreshed.accessToken, config.TOKEN_ENC_KEY),
    expiresAt: refreshed.expiresAt,
    // Microsoft rotates refresh tokens — persist the new one when present.
    refreshToken: refreshed.refreshToken
      ? encryptToken(refreshed.refreshToken, config.TOKEN_ENC_KEY)
      : undefined,
  });
  return refreshed.accessToken;
}

/** Fallback resolver: the user's first connected Microsoft account. */
export async function getValidMicrosoftAccessToken(
  db: Db,
  config: MicrosoftConfig,
  userId: string,
): Promise<string> {
  const account = await getFirstOauthAccount(db, userId, "microsoft");
  if (!account) {
    throw new Error("Microsoft account not connected for this user");
  }
  return getValidMicrosoftAccessTokenForAccount(db, config, account);
}
