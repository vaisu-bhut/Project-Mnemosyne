"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { usePersonBrief } from "@/hooks/usePeople";
import { ApiError } from "@/lib/api/client";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { BriefingView } from "@/components/people/BriefingView";

export default function PersonBriefPage() {
  const { id } = useParams<{ id: string }>();
  const brief = usePersonBrief(id);

  return (
    <>
      <Link
        href="/people"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> People
      </Link>

      {brief.isLoading ? (
        <FullPageSpinner />
      ) : brief.isError ? (
        <ErrorState
          message={
            brief.error instanceof ApiError ? brief.error.message : "Failed to load briefing"
          }
          onRetry={() => void brief.refetch()}
        />
      ) : brief.data ? (
        <BriefingView briefing={brief.data} />
      ) : null}
    </>
  );
}
