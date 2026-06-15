"use client";

import dynamic from "next/dynamic";
import { Share2 } from "lucide-react";
import { usePeopleGraph } from "@/hooks/usePeople";
import { ApiError } from "@/lib/api/client";
import { CIRCLE_COLOR } from "@/components/people/PeopleGraph3D";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";

// WebGL/three.js — client-only, no SSR.
const PeopleGraph3D = dynamic(
  () => import("@/components/people/PeopleGraph3D").then((m) => m.PeopleGraph3D),
  { ssr: false, loading: () => <FullPageSpinner /> },
);

const LEGEND: { key: string; label: string }[] = [
  { key: "work", label: "Work" },
  { key: "personal", label: "Personal" },
  { key: "health", label: "Health" },
  { key: "shareable", label: "Shareable" },
  { key: "_", label: "Uncategorized" },
];

export function PeopleGraphPanel() {
  const graph = usePeopleGraph();

  if (graph.isLoading) return <FullPageSpinner />;
  if (graph.isError) {
    return (
      <ErrorState
        message={graph.error instanceof ApiError ? graph.error.message : "Failed to load graph"}
        onRetry={() => void graph.refetch()}
      />
    );
  }
  if (!graph.data || graph.data.nodes.length === 0) {
    return (
      <EmptyState
        icon={Share2}
        title="No connections yet"
        description="People get linked when they appear together in your emails, meetings, and notes. Ingest data, then run consolidation in Settings to build the graph."
      />
    );
  }

  const { nodes, links, totalPeople, truncated } = graph.data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {LEGEND.map((l) => (
            <span key={l.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: CIRCLE_COLOR[l.key] }}
              />
              {l.label}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {nodes.length} people · {links.length} connections
          {truncated && ` · showing top ${nodes.length} of ${totalPeople}`}
        </p>
      </div>

      <PeopleGraph3D data={graph.data} />

      <p className="text-xs text-muted-foreground">
        Node size = closeness · color = circle · link thickness = shared episodes. Drag to rotate,
        scroll to zoom, click a person to open them.
      </p>
    </div>
  );
}
