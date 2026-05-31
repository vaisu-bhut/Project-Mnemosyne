import type { AppConfig } from "../config/index.js";
import {
  getOauthAccount,
  updateOauthTokens,
  type Db,
} from "../db/index.js";
import { decryptToken, encryptToken } from "./crypto.js";

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

/** Build the consent URL. `state` is a signed CSRF nonce. */
export function buildGoogleAuthUrl(config: GoogleConfig, state: string): string {
  const { id } = requireClient(config);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // get a refresh token
    prompt: "consent",
    state,
  });
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
 * Return a valid (decrypted) Google access token for a user, refreshing and
 * re-persisting it if it has expired (or is about to). Throws if the user has
 * not connected Google.
 */
export async function getValidGoogleAccessToken(
  db: Db,
  config: GoogleConfig,
  userId: string,
): Promise<string> {
  const account = await getOauthAccount(db, userId, "google");
  if (!account || !account.access_token) {
    throw new Error("Google account not connected for this user");
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

  const refreshed = await refreshAccessToken(
    config,
    decryptToken(account.refresh_token, config.TOKEN_ENC_KEY),
  );
  await updateOauthTokens(db, account.id, {
    accessToken: encryptToken(refreshed.accessToken, config.TOKEN_ENC_KEY),
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}
