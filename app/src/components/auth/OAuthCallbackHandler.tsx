"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { FullPageSpinner } from "@/components/common/Spinner";

/**
 * Shared OAuth web hand-off landing logic for both providers. The backend
 * callback (mode=web) 302-redirects here with the outcome in the URL *fragment*:
 *   - sign-in:  `#accessToken=…&refreshToken=…`  → adopt the session
 *   - link:     `#linked=1`                       → already signed in, go home-ish
 *   - conflict: `#error=account_in_use`           → show the error
 * The fragment never hits a server or appears in logs. We read it client-side,
 * strip it, and route on.
 */
export function OAuthCallbackHandler({ provider }: { provider: "Google" | "Microsoft" }) {
  const router = useRouter();
  const { adoptSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against StrictMode's double-invoke in dev
    ran.current = true;

    void (async () => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const params = new URLSearchParams(hash);
      const accessToken = params.get("accessToken");
      const refreshToken = params.get("refreshToken");
      const linked = params.get("linked");
      const oauthError = params.get("error");

      // Strip the fragment before doing anything else so tokens/outcomes don't
      // linger for back-nav/bookmarks.
      window.history.replaceState(null, "", window.location.pathname);

      // Link flow (already signed in): no tokens, just an outcome.
      if (oauthError === "account_in_use") {
        setError(`That ${provider} account is already linked to another Mnemosyne user.`);
        return;
      }
      if (linked === "1") {
        router.replace("/settings");
        return;
      }

      // Sign-in flow: adopt the issued token pair.
      if (!accessToken || !refreshToken) {
        setError("Sign-in didn't return the expected tokens.");
        return;
      }
      try {
        await adoptSession({ accessToken, refreshToken });
        router.replace("/");
      } catch {
        setError("Couldn't complete sign-in. Please try again.");
      }
    })();
  }, [adoptSession, router, provider]);

  if (error) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/settings" className="text-sm font-medium text-primary hover:underline">
          Back to Settings
        </Link>
      </main>
    );
  }

  return <FullPageSpinner />;
}
