"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Quote, Trash2, X } from "lucide-react";
import { useFacts, useUpdateFact, useDeleteFact } from "@/hooks/useBrowse";
import { Citation } from "@/components/Citation";
import type { Fact, FactStatus } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner, Spinner } from "@/components/common/Spinner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FILTERS: { value: FactStatus | "all"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "stale", label: "Stale" },
  { value: "retracted", label: "Retracted" },
  { value: "all", label: "All" },
];
const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const STATUS_VARIANT: Record<FactStatus, "secondary" | "warning" | "destructive"> = {
  active: "secondary",
  stale: "warning",
  retracted: "destructive",
};

export function FactsTab() {
  const [status, setStatus] = useState<FactStatus | "all">("active");
  const facts = useFacts(status === "all" ? {} : { status });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as FactStatus | "all")}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {facts.isLoading ? (
        <FullPageSpinner />
      ) : facts.isError ? (
        <ErrorState
          message={facts.error instanceof ApiError ? facts.error.message : "Failed to load"}
          onRetry={() => void facts.refetch()}
        />
      ) : facts.data && facts.data.length > 0 ? (
        <div className="space-y-2">
          {facts.data.map((f) => (
            <FactItem key={f.id} fact={f} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Quote}
          title="No facts here"
          description="Facts are extracted automatically after you ingest a source."
        />
      )}
    </div>
  );
}

function FactItem({ fact }: { fact: Fact }) {
  const update = useUpdateFact();
  const remove = useDeleteFact();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.statement);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function save() {
    const statement = draft.trim();
    if (!statement || statement === fact.statement) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id: fact.id, input: { statement } },
      {
        onSuccess: () => {
          toast.success("Fact updated");
          setEditing(false);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Failed to update fact"),
      },
    );
  }

  function setStatus(status: FactStatus) {
    update.mutate(
      { id: fact.id, input: { status } },
      {
        onSuccess: () => toast.success(`Marked ${status}`),
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Failed to update fact"),
      },
    );
  }

  function onDelete() {
    remove.mutate(fact.id, {
      onSuccess: () => toast.success("Fact deleted (its source episode is kept)"),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete fact"),
    });
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      {editing ? (
        <div className="flex items-center gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <Button size="icon" variant="secondary" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Spinner /> : <Check className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setDraft(fact.statement);
              setEditing(false);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <p className="text-sm">{fact.statement}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={STATUS_VARIANT[fact.status]}>{fact.status}</Badge>
        {fact.reinforced > 0 && <Badge variant="outline">reinforced ×{fact.reinforced}</Badge>}
        <Citation episodeId={fact.sourceEpisode} />

        <div className="ml-auto flex items-center gap-1">
          {!editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          )}
          {fact.status === "active" && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("stale")}>
              Mark stale
            </Button>
          )}
          {confirmDelete ? (
            <>
              <Button size="sm" variant="destructive" onClick={onDelete} disabled={remove.isPending}>
                {remove.isPending ? <Spinner /> : "Confirm"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
