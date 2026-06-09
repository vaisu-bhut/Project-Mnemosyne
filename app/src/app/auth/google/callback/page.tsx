"use client";

import { OAuthCallbackHandler } from "@/components/auth/OAuthCallbackHandler";

export default function GoogleCallbackPage() {
  return <OAuthCallbackHandler provider="Google" />;
}
