"use client";

import { OAuthCallbackHandler } from "@/components/auth/OAuthCallbackHandler";

export default function MicrosoftCallbackPage() {
  return <OAuthCallbackHandler provider="Microsoft" />;
}
