"use client";

import { SearchX } from "lucide-react";
import type { SearchResult } from "@/lib/api/types";
import { useEpisodeDrawer } from "@/components/episodes/EpisodeDrawerProvider";
import { Citation } from "@/components/Citation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, pct } from "@/lib/format";

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {title} <span className="font-normal">({count})</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function SearchResults({ result }: { result: SearchResult }) {
  const { open } = useEpisodeDrawer();
  const empty =
    result.facts.length === 0 && result.episodes.length === 0 && result.entities.length === 0;

  if (empty) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <SearchX className="size-6" />
        <p className="text-sm">No matches in this mode. Try a different query or ingest more.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Facts" count={result.facts.length}>
        {result.facts.map((f) => (
          <Card key={f.id} className="flex items-start justify-between gap-3 p-3">
            <p className="text-sm">{f.statement}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary" title="confidence">
                {pct(f.confidence)}
              </Badge>
              <Citation episodeId={f.citation.episodeId} />
            </div>
          </Card>
        ))}
      </Section>

      <Section title="Episodes" count={result.episodes.length}>
        {result.episodes.map((e) => (
          <Card key={e.id} className="space-y-1.5 p-3">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => open(e.id)}
                className="text-left text-sm font-medium hover:underline"
              >
                {e.title ?? "Untitled episode"}
              </button>
              {e.occurredAt && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(e.occurredAt)}
                </span>
              )}
            </div>
            {e.snippet && <p className="text-sm text-muted-foreground">{e.snippet}</p>}
            <Citation episodeId={e.id} />
          </Card>
        ))}
      </Section>

      <Section title="Entities" count={result.entities.length}>
        <div className="flex flex-wrap gap-2">
          {result.entities.map((en) => (
            <Badge key={en.id} variant="outline" className="gap-1.5">
              {en.canonicalName}
              <span className="text-muted-foreground">· {en.type}</span>
            </Badge>
          ))}
        </div>
      </Section>
    </div>
  );
}
