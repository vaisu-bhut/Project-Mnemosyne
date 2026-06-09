import { SignJWT, jwtVerify } from "jose";

export interface AccessClaims {
  userId: string;
  email: string;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Sign a short-lived HS256 access token (sub = userId). */
export async function signAccessToken(
  secret: string,
  claims: AccessClaims,
  ttl: string,
): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key(secret));
}

/** Verify an access token; throws if invalid/expired. */
export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(secret));
  return { userId: String(payload.sub), email: String(payload.email ?? "") };
}

/**
 * How the OAuth callback should hand the issued token pair back to the client:
 *   - "json" — return it in the JSON body (native/mobile flow; the default)
 *   - "web"  — 302-redirect the browser to the web app's callback route
 */
export type OAuthMode = "json" | "web";

/**
 * Why the OAuth dance was started:
 *   - "signin" — resolve/create a user by their external identity (default)
 *   - "link"   — attach the external account to the already-logged-in
 *                `linkUserId`, without creating or switching users
 */
export type OAuthIntent = "signin" | "link";

export interface StateClaims {
  nonce: string;
  mode: OAuthMode;
  intent: OAuthIntent;
  /** Present only when intent === "link": the user to attach the account to. */
  linkUserId?: string;
}

/** Sign a short-lived state token carrying the OAuth CSRF nonce + client mode. */
export async function signState(
  secret: string,
  nonce: string,
  mode: OAuthMode = "json",
  intent: OAuthIntent = "signin",
  linkUserId?: string,
): Promise<string> {
  return new SignJWT({ nonce, mode, intent, ...(linkUserId ? { linkUserId } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key(secret));
}

/** Verify a state token; returns its claims, or null if invalid/expired. */
export async function verifyState(
  secret: string,
  token: string,
): Promise<StateClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    const linkUserId = payload.linkUserId ? String(payload.linkUserId) : undefined;
    return {
      nonce: String(payload.nonce ?? ""),
      mode: payload.mode === "web" ? "web" : "json",
      intent: payload.intent === "link" ? "link" : "signin",
      ...(linkUserId ? { linkUserId } : {}),
    };
  } catch {
    return null;
  }
}
