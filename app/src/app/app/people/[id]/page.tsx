"use client";

import { useMemo } from "react";
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
import { useRegisterChatContext } from "@/lib/chat/ChatPanelProvider";

export default function PersonBriefPage() {
  const { id } = useParams<{ id: string }>();
  const brief = usePersonBrief(id);
  const summarize = useSummarizeEntity(id);

  const name = brief.data?.name;
  const chatContext = useMemo(
    () => ({
      title: name ? `Ask about ${name}` : "Ask about this person",
      scope: { entityId: id },
      suggestions: name
        ? [
            `What's my relationship with ${name}?`,
            `What do I owe ${name}?`,
            `What should I follow up on with ${name}?`,
          ]
        : undefined,
    }),
    [name, id],
  );
  useRegisterChatContext(chatContext);

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
          href="/app/people"
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
    </>
  );
}
