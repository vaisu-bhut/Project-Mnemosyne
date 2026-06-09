"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ingestStatusKey,
  sourceKeys,
  useIngestSource,
  useSources,
} from "@/hooks/useSources";
import type { Account, Source } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { useAccounts } from "@/hooks/useAccounts";
import { Button } from "@/components/ui/button";
import { SourceCard } from "@/components/sources/SourceCard";
import { ConnectedAccountsCard } from "@/components/accounts/ConnectedAccountsCard";
import { CreateSourceDialog } from "@/components/sources/CreateSourceDialog";
import { ClassifySourceDialog } from "@/components/sources/ClassifySourceDialog";

interface SourceGroup {
  key: string;
  label: string;
  sources: Source[];
}

/** Group connectors under their connected account; account-less ones go last. */
function buildGroups(sources: Source[], accounts: Account[]): SourceGroup[] {
  const byAccount = new Map<string, Source[]>();
  const local: Source[] = [];
  for (const s of sources) {
    if (s.oauthAccountId) {
      const list = byAccount.get(s.oauthAccountId) ?? [];
      list.push(s);
      byAccount.set(s.oauthAccountId, list);
    } else {
      local.push(s);
    }
  }
  const groups: SourceGroup[] = [];
  for (const acct of accounts) {
    const list = byAccount.get(acct.id);
    if (list && list.length) {
      groups.push({
        key: acct.id,
        label: acct.email ?? acct.displayName ?? acct.providerAccountId,
        sources: list,
      });
      byAccount.delete(acct.id);
    }
  }
  // Sources whose account is gone (disconnected) — still show them.
  for (const [id, list] of byAccount) {
    groups.push({ key: id, label: "Disconnected account", sources: list });
  }
  if (local.length) groups.push({ key: "local", label: "Local & other", sources: local });
  return groups;
}

export default function SourcesPage() {
  const qc = useQueryClient();
  const sources = useSources();
  const accounts = useAccounts();
  const ingest = useIngestSource();

  const [tab, setTab] = useState<"accounts" | "sources">("accounts");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  // Sources with a live ingest run we're polling (drives the card's feed).
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());

  function setActive(id: string, on: boolean) {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleIngest(source: Source) {
    // Reset any prior run status so the card starts the new run cleanly.
    void qc.removeQueries({ queryKey: ingestStatusKey(source.id) });
    ingest.mutate(source.id, {
      onSuccess: () => {
        toast.success(`Ingestion started for ${source.displayName}`, {
          description: "Live progress shows on the card as items are ingested.",
        });
        setActive(source.id, true);
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Failed to start ingestion");
      },
    });
  }

  // Called by a card once its finished run has lingered: stop polling + refresh.
  function handleSettled(sourceId: string) {
    setActive(sourceId, false);
    void qc.invalidateQueries({ queryKey: sourceKeys.all });
  }

  return (
    <>
      <PageHeader
        title="Connections"
        description="Connected accounts, and the connectors (data streams) that feed memory."
        action={
          tab === "sources" ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New connector
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 inline-flex rounded-md border bg-muted/40 p-1">
        {(["accounts", "sources"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "accounts" ? (
        <ConnectedAccountsCard />
      ) : sources.isLoading ? (
        <FullPageSpinner />
      ) : sources.isError ? (
        <ErrorState
          message={
            sources.error instanceof ApiError ? sources.error.message : "Failed to load sources"
          }
          onRetry={() => void sources.refetch()}
        />
      ) : sources.data && sources.data.length > 0 ? (
        <div className="space-y-6">
          {buildGroups(sources.data, accounts.data ?? []).map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{group.label}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.sources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    active={activeIds.has(source.id)}
                    onIngest={handleIngest}
                    onEdit={setEditing}
                    onSettled={handleSettled}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Database}
          title="No connectors yet"
          description="Add a filesystem folder of notes (try examples/journal), or connect a Google/Microsoft account on the Accounts tab then add its apps."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New connector
            </Button>
          }
        />
      )}

      <CreateSourceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ClassifySourceDialog
        source={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}
