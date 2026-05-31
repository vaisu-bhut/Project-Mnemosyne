import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import {
  createSession,
  createUser,
  deleteSessionByHash,
  findSessionByHash,
  getUserByEmail,
  getUserById,
  upsertOauthAccount,
  type Db,
  type User,
} from "../db/index.js";
import { encryptToken, sha256Hex } from "./crypto.js";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleProfile,
} from "./google.js";
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

  // --- Google OAuth (login + Gmail access) ---
  app.get("/auth/google/url", async () => {
    const state = await signState(config.JWT_SECRET, randomBytes(16).toString("hex"));
    return { url: buildGoogleAuthUrl(config, state) };
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/google/callback",
    async (req, reply) => {
      const { code, state } = req.query;
      if (!code || !state || !(await verifyState(config.JWT_SECRET, state))) {
        reply.code(400);
        return { error: "invalid oauth callback (missing/expired state or code)" };
      }
      const tokens = await exchangeCodeForTokens(config, code);
      const profile = await fetchGoogleProfile(tokens.accessToken);

      let user = await getUserByEmail(db, profile.email);
      user ??= await createUser(db, {
        email: profile.email,
        displayName: profile.name ?? null,
      });

      await upsertOauthAccount(db, {
        userId: user.id,
        provider: "google",
        providerAccountId: profile.sub,
        accessToken: encryptToken(tokens.accessToken, config.TOKEN_ENC_KEY),
        refreshToken: tokens.refreshToken
          ? encryptToken(tokens.refreshToken, config.TOKEN_ENC_KEY)
          : null,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope ?? null,
      });

      // Mobile flow: return the token pair as JSON. (A native app would receive
      // this via a custom-scheme redirect; documented in the README.)
      return { user: publicUser(user), ...(await issueTokens(deps, user)) };
    },
  );
}
