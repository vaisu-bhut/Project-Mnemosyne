"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { refreshAccessToken } from "@/lib/api/client";
import { authApi, type LoginInput, type RegisterInput } from "@/lib/api/endpoints";
import type { AuthUser } from "@/lib/api/types";
import {
  clearSession,
  getRefreshToken,
  onSessionCleared,
  setSession,
} from "./tokenStore";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  user: AuthUser | null;
  status: Status;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Bootstrap: re-establish the session from the stored refresh token, then
  // confirm identity via /auth/me (BACKEND.md §6).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!getRefreshToken()) {
        if (active) setStatus("anonymous");
        return;
      }
      const token = await refreshAccessToken();
      if (!active) return;
      if (!token) {
        setStatus("anonymous");
        return;
      }
      try {
        const { user: me } = await authApi.me();
        if (!active) return;
        setUser(me);
        setStatus("authenticated");
      } catch {
        if (active) setStatus("anonymous");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // A failed background refresh clears the session — reflect that in the UI.
  useEffect(
    () =>
      onSessionCleared(() => {
        setUser(null);
        setStatus("anonymous");
      }),
    [],
  );

  const login = useCallback(async (input: LoginInput) => {
    const res = await authApi.login(input);
    setSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await authApi.register(input);
    setSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        /* best-effort server-side revoke; clear locally regardless */
      }
    }
    clearSession();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
