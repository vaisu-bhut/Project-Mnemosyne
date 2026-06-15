"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Archive, FileText, GitBranch, Trash2, X } from "lucide-react";
import type { EpisodeHit, RetentionTier, TraceFact } from "@/lib/api/types";
import { useEpisodeTrace, useForgetEpisode, useSetRetention } from "@/hooks/useRetrieve";
import { useMode } from "@/lib/mode/ModeProvider";
import { ApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/common/Spinner";

const TIERS: { value: RetentionTier; label: string }[] = [
  { value: "raw_forever", label: "Keep forever" },
  { value: "standard", label: "Standard" },
  { value: "ephemeral", label: "Ephemeral" },
];

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EpisodeDrawer({
  episodeId,
  hit,
  open,
  onOpenChange,
  onForgotten,
}: {
  episodeId: string | null;
  hit: EpisodeHit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onForgotten?: (episodeId: string) => void;
}) {
  const { mode, includeSensitive } = useMode();
  const forget = useForgetEpisode();
  const retention = useSetRetention();
  const trace = useEpisodeTrace(open ? episodeId : null, { mode, includeSensitive });
  const [confirmForget, setConfirmForget] = useState(false);
  const [tier, setTier] = useState<RetentionTier>("standard");

  function handleOpenChange(next: boolean) {
    if (!next) setConfirmForget(false);
    onOpenChange(next);
  }

  async function onForget() {
    if (!episodeId) return;
    try {
      await forget.mutateAsync(episodeId);
      toast.success("Episode forgotten across all stores");
      onForgotten?.(episodeId);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to forget episode");
    }
  }

  async function onApplyRetention() {
    if (!episodeId) return;
    try {
      await retention.mutateAsync({ episodeId, tier });
      toast.success(`Retention set to ${tier.replace("_", " ")}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to set retention");
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto border-l bg-background p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="flex items-center gap-2 text-lg font-semibold">
              <FileText className="size-4" /> Source episode
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Source episode detail with forget and retention controls.
          </DialogPrimitive.Description>

          <div className="space-y-2">
            <p className="font-medium">{hit?.title ?? "Untitled episode"}</p>
            {hit?.occurredAt && (
              <p className="text-xs text-muted-foreground">{formatDate(hit.occurredAt)}</p>
            )}
            {hit?.snippet ?? trace.data?.episode.snippet ? (
              <p className="rounded-md bg-muted p-3 text-sm leading-relaxed">
                {hit?.snippet ?? trace.data?.episode.snippet}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No preview available — open Search to retrieve this episode&apos;s text.
              </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
              <dt>Episode</dt>
              <dd className="truncate font-mono">{episodeId}</dd>
              {hit?.citation.sourceId && (
                <>
                  <dt>Source</dt>
                  <dd className="truncate font-mono">{hit.citation.sourceId}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="space-y-2 border-t pt-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="size-4" /> Extraction trace
            </p>
            <p className="text-xs text-muted-foreground">
              What this episode taught your memory — and how well-reinforced each claim is.
            </p>
            {trace.isPending ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Spinner className="size-3" /> Tracing…
              </div>
            ) : trace.isError ? (
              <p className="text-sm text-muted-foreground">Couldn&apos;t load the trace.</p>
            ) : trace.data && trace.data.facts.length > 0 ? (
              <ul className="space-y-2">
                {trace.data.facts.map((f) => (
                  <TraceFactRow key={f.id} fact={f} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No facts were derived from this episode.
              </p>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Archive className="size-4" /> Retention
            </p>
            <div className="flex items-center gap-2">
              <select
                className={selectClass}
                value={tier}
                onChange={(e) => setTier(e.target.value as RetentionTier)}
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                onClick={onApplyRetention}
                disabled={retention.isPending}
              >
                {retention.isPending && <Spinner />}
                Apply
              </Button>
            </div>
          </div>

          <div className="mt-auto space-y-2 border-t pt-4">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <Trash2 className="size-4" /> Forget
            </p>
            <p className="text-xs text-muted-foreground">
              Irreversibly purges this episode and its derived facts, edges, and open loops.
            </p>
            {confirmForget ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onForget}
                  disabled={forget.isPending}
                >
                  {forget.isPending && <Spinner />}
                  Confirm forget
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmForget(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmForget(true)}>
                <Trash2 />
                Forget episode
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const STATUS_STYLES: Record<TraceFact["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  stale: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  retracted: "bg-destructive/10 text-destructive line-through",
};

function reinforcedLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** One derived fact: the claim, its trust status, and reinforcement history —
 * the "from this, I derived this, last reinforced N days ago" line. */
function TraceFactRow({ fact }: { fact: TraceFact }) {
  return (
    <li className="rounded-md border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className={cn("leading-snug", fact.status === "retracted" && "text-muted-foreground")}>
          {fact.statement}
        </p>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            STATUS_STYLES[fact.status],
          )}
        >
          {fact.status}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Reinforced {fact.reinforced}×{" · "}
        last reinforced {reinforcedLabel(fact.daysSinceReinforced)}
        {" · "}
        {Math.round(fact.confidence * 100)}% confidence
      </p>
    </li>
  );
}
