"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Sparkles } from "lucide-react";
import { usePersonBrief } from "@/hooks/usePeople";
import { useSummarizeEntity } from "@/hooks/useAdmin";
import { ApiError } from "@/lib/api/client";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner, Spinner } from "@/components/common/Spinner";
import { BriefingView } from "@/components/people/BriefingView";
import { Button } from "@/components/ui/button";
import { AskLauncher } from "@/components/chat/AskLauncher";

export default function PersonBriefPage() {
  const { id } = useParams<{ id: string }>();
  const brief = usePersonBrief(id);
  const summarize = useSummarizeEntity(id);

  function regenerate() {
    summarize.mutate(undefined, {
      onSuccess: (res) =>
        toast.success(res.summary ? "Summary regenerated" : "Not enough facts to summarize yet"),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Failed to summarize"),
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/people"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> People
        </Link>
        {brief.data && (
          <Button variant="outline" size="sm" onClick={regenerate} disabled={summarize.isPending}>
            {summarize.isPending ? <Spinner /> : <Sparkles />}
            Regenerate summary
          </Button>
        )}
      </div>

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

      {brief.data && (
        <AskLauncher
          title={`Ask about ${brief.data.name}`}
          scope={{ entityId: id }}
          suggestions={[
            `What's my relationship with ${brief.data.name}?`,
            `What do I owe ${brief.data.name}?`,
            `What should I follow up on with ${brief.data.name}?`,
          ]}
        />
      )}
    </>
  );
}
