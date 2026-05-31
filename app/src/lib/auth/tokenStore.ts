/**
 * Token storage for the documented token model (BACKEND.md §6):
 *   - access token: short-lived JWT (~15m), kept in memory only
 *   - refresh token: opaque (~30d), persisted in localStorage, rotated on use
 *
 * On a hard reload the in-memory access token is gone, so the session is
 * re-established from the stored refresh token (see refreshAccessToken in
 * ../api/client.ts).
 */

const REFRESH_KEY = "mnemosyne.refreshToken";

let accessToken: string | null = null;

type Listener = () => void;
const clearedListeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

function setRefreshToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(REFRESH_KEY, token);
  else window.localStorage.removeItem(REFRESH_KEY);
}

/** Persist a freshly issued token pair. */
export function setSession(tokens: { accessToken: string; refreshToken: string }): void {
  accessToken = tokens.accessToken;
  setRefreshToken(tokens.refreshToken);
}

/** Drop all tokens and notify listeners (used to force the UI back to /login). */
export function clearSession(): void {
  accessToken = null;
  setRefreshToken(null);
  for (const listener of clearedListeners) listener();
}

/** Subscribe to forced session clears (e.g. a background refresh failed). */
export function onSessionCleared(listener: Listener): () => void {
  clearedListeners.add(listener);
  return () => clearedListeners.delete(listener);
}
