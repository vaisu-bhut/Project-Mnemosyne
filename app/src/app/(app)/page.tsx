"use client";

import { useAuth } from "@/lib/auth/AuthProvider";
import { PageHeader } from "@/components/common/PageHeader";
import { Placeholder } from "@/components/common/Placeholder";

export default function DashboardPage() {
  const { user } = useAuth();
  const name = user?.displayName?.split(" ")[0] ?? "there";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${name}`}
        description="Your ambient memory — what's on your mind, nudges, and briefings."
      />
      <Placeholder phase="Phase 4 (agent mesh: /mind, conduct, nudges)" />
    </>
  );
}
