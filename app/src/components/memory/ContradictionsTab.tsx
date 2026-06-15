"use client";

import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { useContradictions, useResolveContradiction } from "@/hooks/useAdmin";
import { Citation } from "@/components/Citation";
import { ApiError } from "@/lib/api/client";
import type { Contradiction } from "@/lib/api/types";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Contradictions, resolvable where curation happens. Each pair shows both
 * claims; the user picks which is current — the other is marked stale (the
 * source episodes are never touched). */
export function ContradictionsTab() {
  const contradictions = useContradictions();

  if (contradictions.isLoading) return <FullPageSpinner />;
  if (contradictions.isError) {
    return (
      <ErrorState
        message={
          contradictions.error instanceof ApiError
            ? contradictions.error.message
            : "Failed to load contradictions"
        }
        onRetry={() => void contradictions.refetch()}
      />
    );
  }
  if (!contradictions.data || contradictions.data.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No contradictions"
        description="When two facts disagree, they show up here to resolve. Run consolidation in Settings to detect more."
      />
    );
  }

  return (
    <div className="space-y-3">
      {contradictions.data.map((c) => (
        <ContradictionItem key={c.id} contradiction={c} />
      ))}
    </div>
  );
}

function ContradictionItem({ contradiction: c }: { contradiction: Contradiction }) {
  const resolve = useResolveContradiction();

  function keep(keepId: string, staleId: string) {
    resolve.mutate(
      { id: staleId, status: "stale" },
      {
        onSuccess: () => toast.success("Resolved — the other fact was marked stale"),
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Failed to resolve"),
      },
    );
    void keepId;
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium">Which is current?</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Side
          statement={c.statement}
          episodeId={c.episode}
          disabled={resolve.isPending}
          onKeep={() => keep(c.id, c.contradictsId)}
        />
        <Side
          statement={c.contradictsStatement}
          episodeId={null}
          disabled={resolve.isPending}
          onKeep={() => keep(c.contradictsId, c.id)}
        />
      </div>
    </Card>
  );
}

function Side({
  statement,
  episodeId,
  disabled,
  onKeep,
}: {
  statement: string;
  episodeId: string | null;
  disabled: boolean;
  onKeep: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="text-sm">{statement}</p>
      <div className="mt-auto flex items-center justify-between gap-2">
        {episodeId ? <Citation episodeId={episodeId} /> : <span />}
        <Button size="sm" variant="secondary" onClick={onKeep} disabled={disabled}>
          Keep this
        </Button>
      </div>
    </div>
  );
}
