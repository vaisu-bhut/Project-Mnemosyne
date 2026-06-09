"use client";

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { useEpisodes } from "@/hooks/useBrowse";
import { useEpisodeDrawer } from "@/components/episodes/EpisodeDrawerProvider";
import { ApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const KINDS = ["all", "email", "calendar_event", "contact", "note"] as const;
const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EpisodesTab() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const episodes = useEpisodes(kind === "all" ? {} : { kind });
  const { open, register } = useEpisodeDrawer();

  useEffect(() => {
    if (!episodes.data) return;
    register(
      episodes.data.map((e) => ({
        id: e.id,
        title: e.title,
        snippet: e.snippet,
        occurredAt: e.occurredAt,
        distance: 0,
        citation: { episodeId: e.id, sourceId: e.sourceId },
      })),
    );
  }, [episodes.data, register]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <select
          className={selectClass}
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k === "all" ? "All kinds" : k.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      {episodes.isLoading ? (
        <FullPageSpinner />
      ) : episodes.isError ? (
        <ErrorState
          message={episodes.error instanceof ApiError ? episodes.error.message : "Failed to load"}
          onRetry={() => void episodes.refetch()}
        />
      ) : episodes.data && episodes.data.length > 0 ? (
        <div className="space-y-2">
          {episodes.data.map((e) => (
            <Card
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => open(e.id)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") open(e.id);
              }}
              className="cursor-pointer p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate font-medium">{e.title ?? "(untitled)"}</p>
                <Badge variant="outline" className="shrink-0">
                  {e.kind.replace("_", " ")}
                </Badge>
              </div>
              {e.snippet && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.snippet}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{formatDate(e.occurredAt)}</p>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ScrollText}
          title="No episodes yet"
          description="Ingest a source (Gmail, Calendar, notes) and episodes will appear here."
        />
      )}
    </div>
  );
}
