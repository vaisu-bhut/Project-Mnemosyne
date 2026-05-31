"use client";

import { useEffect } from "react";
import { CircleHelp, Clock, MessageSquare, NotebookPen } from "lucide-react";
import type { Briefing } from "@/lib/api/types";
import { useEpisodeDrawer } from "@/components/episodes/EpisodeDrawerProvider";
import { Citation } from "@/components/Citation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, pct } from "@/lib/format";

export function BriefingView({ briefing }: { briefing: Briefing }) {
  const { register } = useEpisodeDrawer();

  // Make the briefing's interactions known so their citations render detail.
  useEffect(() => {
    register(
      briefing.recentInteractions.map((i) => ({
        id: i.episodeId,
        title: i.title,
        snippet: i.snippet,
        occurredAt: i.occurredAt,
        distance: 0,
        citation: { episodeId: i.episodeId, sourceId: null },
      })),
    );
  }, [briefing, register]);

  const contact =
    briefing.daysSinceContact === null
      ? "no recorded contact"
      : `${briefing.daysSinceContact}d since last contact`;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{briefing.name}</h2>
          {briefing.closeness !== null && (
            <Badge variant="secondary">{pct(briefing.closeness)} close</Badge>
          )}
        </div>
        {briefing.aliases.length > 0 && (
          <p className="text-xs text-muted-foreground">aka {briefing.aliases.join(", ")}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {briefing.interactions} interaction{briefing.interactions === 1 ? "" : "s"} · {contact}
          {briefing.lastContactAt && ` · last ${formatDate(briefing.lastContactAt)}`}
        </p>
      </div>

      {briefing.summary && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed">{briefing.summary}</CardContent>
        </Card>
      )}

      {briefing.suggestedQuestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleHelp className="size-4" /> Suggested questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {briefing.suggestedQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {briefing.openThreads.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4" /> Open threads
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {briefing.openThreads.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <Badge variant={t.direction === "i_owe" ? "destructive" : "secondary"}>
                  {t.direction === "i_owe" ? "you owe" : "owed to you"}
                </Badge>
                <span>{t.description}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {briefing.recentInteractions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4" /> Recent interactions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {briefing.recentInteractions.map((i) => (
              <div key={i.episodeId} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{i.title ?? "Untitled"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(i.occurredAt)}
                  </span>
                </div>
                {i.snippet && <p className="text-sm text-muted-foreground">{i.snippet}</p>}
                <Citation episodeId={i.episodeId} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {briefing.recentFacts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <NotebookPen className="size-4" /> Recent facts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {briefing.recentFacts.map((f, i) => (
              <div key={i} className="flex items-start justify-between gap-3">
                <p className="text-sm">{f.statement}</p>
                <Citation episodeId={f.episodeId} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
