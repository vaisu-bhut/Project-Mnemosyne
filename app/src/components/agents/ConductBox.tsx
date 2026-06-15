"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles, Wand2 } from "lucide-react";
import { useConduct } from "@/hooks/useConduct";
import { useEpisodeDrawer } from "@/components/episodes/EpisodeDrawerProvider";
import { camelize } from "@/lib/api/casing";
import { ApiError } from "@/lib/api/client";
import type {
  Answer,
  BlackboardEntry,
  Briefing,
  RelationshipAlert,
  RouteResult,
} from "@/lib/api/types";
import { AnswerView } from "@/components/search/AnswerView";
import { BriefingView } from "@/components/people/BriefingView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/common/Spinner";

export function ConductBox() {
  const { register } = useEpisodeDrawer();
  const conduct = useConduct();
  const [query, setQuery] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    conduct.mutate(
      { query: q },
      {
        onSuccess: (data) => {
          if (data.intent === "recall") register((data.result as Answer).used.episodes);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Conductor request failed"),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="size-4" /> Ask your conductor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="e.g. brief me on Sara · what's on my mind · who have I lost touch with"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" disabled={conduct.isPending || !query.trim()}>
            {conduct.isPending ? <Spinner /> : <Sparkles />}
            Conduct
          </Button>
        </form>
        {conduct.data && <ConductResult data={conduct.data} />}
      </CardContent>
    </Card>
  );
}

function ConductResult({ data }: { data: RouteResult }) {
  const label = (
    <p className="text-xs text-muted-foreground">
      Routed to <span className="font-medium">{data.intent}</span> via {data.via}
    </p>
  );

  if (data.intent === "recall") {
    return (
      <div className="space-y-3">
        {label}
        <AnswerView answer={data.result as Answer} />
      </div>
    );
  }
  if (data.intent === "briefing") {
    return (
      <div className="space-y-3">
        {label}
        <BriefingView briefing={data.result as Briefing} />
      </div>
    );
  }
  if (data.intent === "people") {
    const alerts = data.result as RelationshipAlert[];
    return (
      <div className="space-y-3">
        {label}
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No relationships are going cold.</p>
        ) : (
          <ul className="space-y-1.5">
            {alerts.map((a) => (
              <li key={a.entityId} className="flex items-center gap-2 text-sm">
                <Badge variant="warning">{a.daysSinceContact}d</Badge>
                <Link href={`/people/${a.entityId}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  // nudges — /conduct returns raw blackboard rows here, so camelize them.
  const entries = camelize<BlackboardEntry[]>(data.result);
  return (
    <div className="space-y-3">
      {label}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing on your mind right now.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.id} className="text-sm">
              {e.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
