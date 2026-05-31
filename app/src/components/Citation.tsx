"use client";

import { FileText } from "lucide-react";
import { useEpisodeDrawer } from "@/components/episodes/EpisodeDrawerProvider";
import { cn } from "@/lib/utils";

/** Click-through chip back to a claim's source episode (BACKEND.md §11). */
export function Citation({
  episodeId,
  label,
  className,
}: {
  episodeId: string | null;
  label?: string;
  className?: string;
}) {
  const { open } = useEpisodeDrawer();
  if (!episodeId) return null;

  return (
    <button
      type="button"
      onClick={() => open(episodeId)}
      title={`Open source episode ${episodeId}`}
      className={cn(
        "inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 align-middle text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <FileText className="size-3" />
      {label ?? `episode:${episodeId.slice(0, 8)}`}
    </button>
  );
}
