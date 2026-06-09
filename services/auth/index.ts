import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import {
  createSession,
  createUser,
  deleteSessionByHash,
  findSessionByHash,
  getUserByEmail,
  getUserById,
  linkOauthAccountForUser,
  upsertOauthAccount,
  type Db,
  type User,
} from "../db/index.js";
import { encryptToken, sha256Hex } from "./crypto.js";
import {
  buildGoogleAuthUrl,
  buildWebCallbackUrl,
  buildWebHandoffUrl,
  exchangeCodeForTokens as exchangeGoogleCode,
  fetchGoogleProfile,
} from "./google.js";
import {
  buildMicrosoftAuthUrl,
  buildMicrosoftHandoffUrl,
  buildMicrosoftWebCallbackUrl,
  exchangeCodeForTokens as exchangeMicrosoftCode,
  fetchMicrosoftProfile,
} from "./microsoft.js";
import { signAccessToken, signState, verifyAccessToken, verifyState } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthDeps {
  db: Db;
  config: AppConfig;
}

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().optional(),
});
const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const RefreshBody = z.object({ refreshToken: z.string().min(1) });

function publicUser(u: User) {
  return { id: u.id, email: u.email, displayName: u.display_name };
}

async function issueTokens(
  deps: AuthDeps,
  user: User,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = await signAccessToken(
    deps.config.JWT_SECRET,
    { userId: user.id, email: user.email },
    deps.config.ACCESS_TOKEN_TTL,
  );
  const refreshToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + deps.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  );
  await createSession(deps.db, user.id, sha256Hex(refreshToken), expiresAt);
  return { accessToken, refreshToken };
}

/** Resolve the authenticated user from a Bearer access token (or null). */
export async function getUserFromRequest(
  config: AppConfig,
  req: FastifyRequest,
): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const claims = await verifyAccessToken(config.JWT_SECRET, header.slice(7));
    return { id: claims.userId, email: claims.email };
  } catch {
    return null;
  }
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { db, config } = deps;

  app.post("/auth/register", async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    if (await getUserByEmail(db, body.email)) {
      reply.code(409);
      return { error: "email already registered" };
    }
    const user = await createUser(db, {
      email: body.email,
      passwordHash: hashPassword(body.password),
      displayName: body.displayName ?? null,
    });
    reply.code(201);
    return { user: publicUser(user), ...(await issueTokens(deps, user)) };
  });

  app.post("/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = await getUserByEmail(db, body.email);
    if (!user?.password_hash || !verifyPassword(body.password, user.password_hash)) {
      reply.code(401);
      return { error: "invalid credentials" };
    }
    return { user: publicUser(user), ...(await issueTokens(deps, user)) };
  });

  // Rotate: consume the old refresh token, issue a fresh pair.
  app.post("/auth/refresh", async (req, reply) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    const session = await findSessionByHash(db, sha256Hex(refreshToken));
    if (!session || session.expires_at.getTime() < Date.now()) {
      reply.code(401);
      return { error: "invalid or expired refresh token" };
    }
    await deleteSessionByHash(db, session.token_hash);
    const user = await getUserById(db, session.user_id);
    if (!user) {
      reply.code(401);
      return { error: "user no longer exists" };
    }
    return { user: publicUser(user), ...(await issueTokens(deps, user)) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    await deleteSessionByHash(db, sha256Hex(refreshToken));
    reply.code(204);
  });

  app.get("/auth/me", async (req, reply) => {
    const authed = await getUserFromRequest(config, req);
    if (!authed) {
      reply.code(401);
      return { error: "authentication required" };
    }
    const user = await getUserById(db, authed.id);
    if (!user) {
      reply.code(401);
      return { error: "user no longer exists" };
    }
    return { user: publicUser(user) };
  });

  // --- OAuth (sign-in + connecting accounts), shared across providers ---
  // `mode=web` makes the callback redirect the browser back to the web app (so a
  // browser can capture the result); anything else => JSON. `intent=link`
  // attaches the account to the already-logged-in caller instead of signing in;
  // it requires a valid Bearer token (req.user). `loginHint` pre-targets a
  // specific account (used by "Add services").
  interface OAuthAdapter {
    provider: string;
    buildAuthUrl: (state: string, opts: { loginHint?: string }) => string;
    exchange: (
      code: string,
    ) => Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date | null; scope?: string }>;
    fetchProfile: (
      accessToken: string,
    ) => Promise<{ providerAccountId: string; email: string; name?: string }>;
    handoffUrl: (origin: string, tokens: { accessToken: string; refreshToken: string }) => string;
    webCallbackUrl: (origin: string, fragment: Record<string, string>) => string;
  }

  type UrlQuery = { mode?: string; intent?: string; loginHint?: string };
  async function oauthUrl(
    adapter: OAuthAdapter,
    req: FastifyRequest<{ Querystring: UrlQuery }>,
    reply: FastifyReply,
  ): Promise<unknown> {
    const mode = req.query.mode === "web" ? "web" : "json";
    const linking = req.query.intent === "link";
    if (linking && !req.user) {
      reply.code(401);
      return { error: "authentication required to link an account" };
    }
    const state = await signState(
      config.JWT_SECRET,
      randomBytes(16).toString("hex"),
      mode,
      linking ? "link" : "signin",
      linking ? req.user!.id : undefined,
    );
    const loginHint =
      typeof req.query.loginHint === "string" && req.query.loginHint
        ? req.query.loginHint
        : undefined;
    return { url: adapter.buildAuthUrl(state, { loginHint }) };
  }

  type CallbackQuery = { code?: string; state?: string };
  async function oauthCallback(
    adapter: OAuthAdapter,
    req: FastifyRequest<{ Querystring: CallbackQuery }>,
    reply: FastifyReply,
  ): Promise<unknown> {
    const { code, state } = req.query;
    const claims = state ? await verifyState(config.JWT_SECRET, state) : null;
    if (!code || !claims) {
      reply.code(400);
      return { error: "invalid oauth callback (missing/expired state or code)" };
    }
    const tokens = await adapter.exchange(code);
    const profile = await adapter.fetchProfile(tokens.accessToken);
    const encAccess = encryptToken(tokens.accessToken, config.TOKEN_ENC_KEY);
    const encRefresh = tokens.refreshToken
      ? encryptToken(tokens.refreshToken, config.TOKEN_ENC_KEY)
      : null;

    // --- Link flow: attach this account to the logged-in user ---
    if (claims.intent === "link") {
      const linkUser = claims.linkUserId ? await getUserById(db, claims.linkUserId) : null;
      if (!linkUser) {
        reply.code(400);
        return { error: "invalid link request (unknown user)" };
      }
      const result = await linkOauthAccountForUser(db, {
        userId: linkUser.id,
        provider: adapter.provider,
        providerAccountId: profile.providerAccountId,
        accessToken: encAccess,
        refreshToken: encRefresh,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope ?? null,
        email: profile.email,
        displayName: profile.name ?? null,
      });
      if (result.status === "conflict") {
        // This account already belongs to another Mnemosyne user — don't steal it.
        if (claims.mode === "web") {
          return reply.redirect(
            adapter.webCallbackUrl(config.WEB_ORIGIN, { error: "account_in_use" }),
            302,
          );
        }
        reply.code(409);
        return { error: "This account is already linked to another user." };
      }
      // Success: the user is already logged in, so issue NO new app tokens.
      if (claims.mode === "web") {
        return reply.redirect(adapter.webCallbackUrl(config.WEB_ORIGIN, { linked: "1" }), 302);
      }
      return { linked: true };
    }

    // --- Sign-in flow: resolve/create the user by their external identity ---
    let user = await getUserByEmail(db, profile.email);
    user ??= await createUser(db, { email: profile.email, displayName: profile.name ?? null });

    await upsertOauthAccount(db, {
      userId: user.id,
      provider: adapter.provider,
      providerAccountId: profile.providerAccountId,
      accessToken: encAccess,
      refreshToken: encRefresh,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope ?? null,
      email: profile.email,
      displayName: profile.name ?? null,
    });

    const issued = await issueTokens(deps, user);
    // Web flow: 302 back to the SPA callback with the token pair in the URL
    // fragment (kept out of server logs / Referer; read client-side).
    if (claims.mode === "web") {
      return reply.redirect(adapter.handoffUrl(config.WEB_ORIGIN, issued), 302);
    }
    // Native/mobile flow: return the token pair as JSON.
    return { user: publicUser(user), ...issued };
  }

  const googleAdapter: OAuthAdapter = {
    provider: "google",
    buildAuthUrl: (state, opts) => buildGoogleAuthUrl(config, state, opts),
    exchange: (code) => exchangeGoogleCode(config, code),
    fetchProfile: async (accessToken) => {
      const p = await fetchGoogleProfile(accessToken);
      return { providerAccountId: p.sub, email: p.email, name: p.name };
    },
    handoffUrl: (origin, tokens) => buildWebHandoffUrl(origin, tokens),
    webCallbackUrl: (origin, fragment) => buildWebCallbackUrl(origin, fragment),
  };

  const microsoftAdapter: OAuthAdapter = {
    provider: "microsoft",
    buildAuthUrl: (state, opts) => buildMicrosoftAuthUrl(config, state, opts),
    exchange: (code) => exchangeMicrosoftCode(config, code),
    fetchProfile: async (accessToken) => {
      const p = await fetchMicrosoftProfile(accessToken);
      return { providerAccountId: p.id, email: p.email, name: p.name };
    },
    handoffUrl: (origin, tokens) => buildMicrosoftHandoffUrl(origin, tokens),
    webCallbackUrl: (origin, fragment) => buildMicrosoftWebCallbackUrl(origin, fragment),
  };

  app.get<{ Querystring: UrlQuery }>("/auth/google/url", (req, reply) =>
    oauthUrl(googleAdapter, req, reply),
  );
  app.get<{ Querystring: CallbackQuery }>("/auth/google/callback", (req, reply) =>
    oauthCallback(googleAdapter, req, reply),
  );
  app.get<{ Querystring: UrlQuery }>("/auth/microsoft/url", (req, reply) =>
    oauthUrl(microsoftAdapter, req, reply),
  );
  app.get<{ Querystring: CallbackQuery }>("/auth/microsoft/callback", (req, reply) =>
    oauthCallback(microsoftAdapter, req, reply),
  );
}
