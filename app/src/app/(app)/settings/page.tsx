"use client";

import { toast } from "sonner";
import { CheckCircle2, GitMerge, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useConsolidate, useContradictions, useHealth } from "@/hooks/useAdmin";
import { ApiError } from "@/lib/api/client";
import type { ConsolidationReport } from "@/lib/api/types";
import { PageHeader } from "@/components/common/PageHeader";
import { Citation } from "@/components/Citation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/common/Spinner";

const REPORT_LABELS: Record<keyof ConsolidationReport, string> = {
  entitiesMerged: "Entities merged",
  factsRetracted: "Facts retracted",
  contradictionsLinked: "Contradictions linked",
  factsStaled: "Facts staled",
  episodesCompressed: "Episodes compressed",
  episodesPurged: "Episodes purged",
  peopleEdges: "People links",
};

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const health = useHealth();
  const consolidate = useConsolidate();
  const contradictions = useContradictions();

  function runConsolidate() {
    consolidate.mutate(undefined, {
      onSuccess: () => toast.success("Consolidation complete"),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Consolidation failed"),
    });
  }

  return (
    <>
      <PageHeader title="Settings" description="Maintenance, data health, and your account." />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Read-only principle */}
        <Card className="lg:col-span-2 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" /> Read-only by design
            </CardTitle>
            <CardDescription>
              Mnemosyne reads your connected accounts to build memory and{" "}
              <strong className="text-foreground">never writes, sends, edits, or deletes</strong>{" "}
              anything in them. This is a deliberate trust constraint, not a missing feature — your
              memory can be wrong without any risk to your real inbox, calendar, or contacts.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* System status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System status</CardTitle>
            <CardDescription>Backend service health.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {health.isLoading ? (
              <Spinner />
            ) : health.data ? (
              Object.entries(health.data.checks).map(([name, ok]) => (
                <div key={name} className="flex items-center gap-1.5 text-sm capitalize">
                  {ok ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  {name}
                </div>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Unavailable</span>
            )}
          </CardContent>
        </Card>

        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Name</p>
              <p>{user?.displayName ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email</p>
              <p>{user?.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </CardContent>
        </Card>

        {/* Consolidation */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitMerge className="size-4" /> Consolidation
            </CardTitle>
            <CardDescription>
              The “sleep” pass: merge aliases, dedup facts, link contradictions, decay, enforce
              retention.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={runConsolidate} disabled={consolidate.isPending}>
              {consolidate.isPending && <Spinner />}
              Run consolidation
            </Button>
            {consolidate.data && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(Object.keys(REPORT_LABELS) as (keyof ConsolidationReport)[]).map((key) => (
                  <div key={key} className="rounded-md border p-3">
                    <p className="text-2xl font-semibold">{consolidate.data[key]}</p>
                    <p className="text-xs text-muted-foreground">{REPORT_LABELS[key]}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contradictions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" /> Contradictions
            </CardTitle>
            <CardDescription>
              Conflicting facts the Guardian has flagged (advisory — never silently retracted).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contradictions.isLoading ? (
              <Spinner />
            ) : contradictions.data && contradictions.data.length > 0 ? (
              <div className="space-y-3">
                {contradictions.data.map((c) => (
                  <div key={c.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p>{c.statement}</p>
                      <Citation episodeId={c.episode} />
                    </div>
                    <div className="my-1.5 flex items-center gap-2">
                      <Badge variant="warning">contradicts</Badge>
                    </div>
                    <p className="text-muted-foreground">{c.contradictsStatement}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No contradictions flagged.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
