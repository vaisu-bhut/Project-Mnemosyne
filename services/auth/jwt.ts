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

/** Sign a short-lived state token for the OAuth CSRF nonce. */
export async function signState(secret: string, nonce: string): Promise<string> {
  return new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key(secret));
}

export async function verifyState(secret: string, token: string): Promise<boolean> {
  try {
    await jwtVerify(token, key(secret));
    return true;
  } catch {
    return false;
  }
}
