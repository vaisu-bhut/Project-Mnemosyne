"use client";

import { useState } from "react";
import { GitMerge, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePeopleHealth } from "@/hooks/usePeople";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { PersonCard } from "@/components/people/PersonCard";
import { MergePeopleDialog } from "@/components/people/MergePeopleDialog";
import { PeopleGraphPanel } from "@/components/people/PeopleGraphPanel";
import { Button } from "@/components/ui/button";

type View = "list" | "graph";

export default function PeoplePage() {
  const people = usePeopleHealth();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const canMerge = (people.data?.length ?? 0) >= 2;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="People"
          description="Relationship health across the people in your memory."
        />
        {canMerge && (
          <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
            <GitMerge className="size-4" /> Merge people
          </Button>
        )}
      </div>

      <div className="mb-4 inline-flex rounded-md border bg-muted/40 p-1">
        {(["list", "graph"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium capitalize transition-colors",
              view === v
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {people.data && (
        <MergePeopleDialog people={people.data} open={mergeOpen} onOpenChange={setMergeOpen} />
      )}

      {view === "graph" ? (
        <PeopleGraphPanel />
      ) : people.isLoading ? (
        <FullPageSpinner />
      ) : people.isError ? (
        <ErrorState
          message={people.error instanceof ApiError ? people.error.message : "Failed to load people"}
          onRetry={() => void people.refetch()}
        />
      ) : people.data && people.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.data.map((person) => (
            <PersonCard key={person.entityId} person={person} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No people yet"
          description="Ingest notes, email, or contacts and people will appear here as they're mentioned."
        />
      )}
    </>
  );
}
