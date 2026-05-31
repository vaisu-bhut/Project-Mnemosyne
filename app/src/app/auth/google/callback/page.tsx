"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { FullPageSpinner } from "@/components/common/Spinner";

/**
 * Google OAuth web hand-off landing page.
 *
 * The backend callback (mode=web) 302-redirects here with the freshly issued
 * token pair in the URL *fragment* — `#accessToken=…&refreshToken=…` — so the
 * tokens never hit a server or appear in logs. We read them client-side, adopt
 * the session (access token in memory, refresh token in localStorage), strip
 * the fragment, and land on the authenticated home.
 */
export default function GoogleCallbackPage() {
  const router = useRouter();
  const { adoptSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against StrictMode's double-invoke in dev
    ran.current = true;

    void (async () => {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const params = new URLSearchParams(hash);
      const accessToken = params.get("accessToken");
      const refreshToken = params.get("refreshToken");

      // Strip the tokens from the address bar + history before doing anything
      // else, so they don't linger in the fragment for back-nav/bookmarks.
      window.history.replaceState(null, "", window.location.pathname);

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
  }, [adoptSession, router]);

  if (error) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/sources" className="text-sm font-medium text-primary hover:underline">
          Back to Sources
        </Link>
      </main>
    );
  }

  return <FullPageSpinner />;
}
