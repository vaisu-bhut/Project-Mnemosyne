"use client";

import { toast } from "sonner";
import { Brain, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useMind, useRunNudger } from "@/hooks/useMind";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Spinner } from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { ConductBox } from "@/components/agents/ConductBox";
import { MindCard } from "@/components/agents/MindCard";

export default function DashboardPage() {
  const { user } = useAuth();
  const mind = useMind();
  const nudger = useRunNudger();
  const name = user?.displayName?.split(" ")[0] ?? "there";

  function runNudger() {
    nudger.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          `Nudger surfaced ${r.total} item${r.total === 1 ? "" : "s"}`,
          {
            description: `${r.openLoopNudges} open loops · ${r.commitmentNudges} commitments · ${r.contradictionNudges} contradictions · ${r.relationshipAlerts} relationship alerts`,
          },
        ),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Nudger failed"),
    });
  }

  return (
    <>
      <PageHeader
        hero
        eyebrow="Conductor"
        title={`Welcome back, ${name}`}
        description="Ask anything across your memory, and see what your agents have surfaced for you today."
      />

      <div className="mb-5">
        <ConductBox />
      </div>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Surfaced
          </p>
          <h2 className="mt-0.5 flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Brain className="size-[18px] text-primary" /> On your mind
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={runNudger} disabled={nudger.isPending}>
          {nudger.isPending ? <Spinner /> : <Zap />}
          Run nudger
        </Button>
      </div>

      {mind.isLoading ? (
        <div className="flex min-h-[25vh] items-center justify-center">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : mind.isError ? (
        <ErrorState
          message={mind.error instanceof ApiError ? mind.error.message : "Failed to load"}
          onRetry={() => void mind.refetch()}
        />
      ) : mind.data && mind.data.length > 0 ? (
        <div className="animate-stagger grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {mind.data.map((entry) => (
            <MindCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Brain}
          title="Nothing on your mind yet"
          description="Run the nudger to surface open loops and relationships going cold."
          action={
            <Button onClick={runNudger} disabled={nudger.isPending}>
              {nudger.isPending ? <Spinner /> : <Zap />}
              Run nudger
            </Button>
          }
        />
      )}
    </>
  );
}
