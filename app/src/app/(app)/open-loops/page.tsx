"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { useOpenLoops } from "@/hooks/useOpenLoops";
import type { LoopStatus } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { OpenLoopItem } from "@/components/openloops/OpenLoopItem";

const FILTERS: { value: LoopStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "rotted", label: "Rotted" },
  { value: "all", label: "All" },
];

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function OpenLoopsPage() {
  const [filter, setFilter] = useState<LoopStatus | "all">("open");
  const loops = useOpenLoops(filter === "all" ? undefined : filter);

  return (
    <>
      <PageHeader
        title="Open Loops"
        description="Promises you owe and are owed, extracted from your memory."
        action={
          <select
            className={selectClass}
            value={filter}
            onChange={(e) => setFilter(e.target.value as LoopStatus | "all")}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        }
      />

      {loops.isLoading ? (
        <FullPageSpinner />
      ) : loops.isError ? (
        <ErrorState
          message={loops.error instanceof ApiError ? loops.error.message : "Failed to load"}
          onRetry={() => void loops.refetch()}
        />
      ) : loops.data && loops.data.length > 0 ? (
        <div className="space-y-2">
          {loops.data.map((loop) => (
            <OpenLoopItem key={loop.id} loop={loop} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ListChecks}
          title="No open loops"
          description="Promises and commitments extracted from ingested notes/email will appear here."
        />
      )}
    </>
  );
}
