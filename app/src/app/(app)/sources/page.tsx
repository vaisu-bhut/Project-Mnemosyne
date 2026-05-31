"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Plus } from "lucide-react";
import { sourceKeys, useIngestSource, useSources } from "@/hooks/useSources";
import type { Source } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { SourceCard } from "@/components/sources/SourceCard";
import { GoogleConnectCard } from "@/components/sources/GoogleConnectCard";
import { CreateSourceDialog } from "@/components/sources/CreateSourceDialog";
import { ClassifySourceDialog } from "@/components/sources/ClassifySourceDialog";

// Optimistic "ingesting" window — there is no job-status endpoint (BACKEND.md
// §11), so we surface a transient badge then refetch.
const INGEST_BADGE_MS = 7000;

export default function SourcesPage() {
  const qc = useQueryClient();
  const sources = useSources();
  const ingest = useIngestSource();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [ingestingIds, setIngestingIds] = useState<Set<string>>(new Set());

  function setIngesting(id: string, on: boolean) {
    setIngestingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleIngest(source: Source) {
    ingest.mutate(source.id, {
      onSuccess: () => {
        toast.success(`Ingestion started for ${source.displayName}`, {
          description: "Runs in the background — results appear in Search shortly.",
        });
        setIngesting(source.id, true);
        setTimeout(() => {
          setIngesting(source.id, false);
          void qc.invalidateQueries({ queryKey: sourceKeys.all });
        }, INGEST_BADGE_MS);
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Failed to start ingestion");
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Sources"
        description="Connect data and ingest it into memory."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Add source
          </Button>
        }
      />

      <div className="mb-6">
        <GoogleConnectCard />
      </div>

      {sources.isLoading ? (
        <FullPageSpinner />
      ) : sources.isError ? (
        <ErrorState
          message={
            sources.error instanceof ApiError ? sources.error.message : "Failed to load sources"
          }
          onRetry={() => void sources.refetch()}
        />
      ) : sources.data && sources.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sources.data.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              ingesting={ingestingIds.has(source.id)}
              onIngest={handleIngest}
              onEdit={setEditing}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Database}
          title="No sources yet"
          description="Add a filesystem folder of notes (try examples/journal) or connect Google."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Add source
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
