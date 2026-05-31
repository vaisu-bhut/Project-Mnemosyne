"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { OpenLoop } from "@/lib/api/types";
import { Citation } from "@/components/Citation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

export function OpenLoopItem({ loop }: { loop: OpenLoop }) {
  const iOwe = loop.direction === "i_owe";
  // Depends on the current time. This list only renders client-side (the page
  // shows a spinner during SSR until the query resolves), so reading the clock
  // here cannot cause a hydration mismatch.
  // eslint-disable-next-line react-hooks/purity
  const overdue = loop.status === "open" && loop.dueAt !== null && new Date(loop.dueAt).getTime() < Date.now();

  return (
    <Card className="flex items-start gap-3 p-3">
      <div className="mt-0.5 text-muted-foreground">
        {iOwe ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">{loop.description}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={iOwe ? "destructive" : "secondary"}>
            {iOwe ? "you owe" : "owed to you"}
          </Badge>
          {loop.status !== "open" && <Badge variant="outline">{loop.status}</Badge>}
          {loop.dueAt && (
            <Badge variant={overdue ? "warning" : "outline"}>
              {overdue ? "overdue " : "due "}
              {formatDate(loop.dueAt)}
            </Badge>
          )}
          {loop.counterparty && (
            <Link
              href={`/people/${loop.counterparty}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              View person
            </Link>
          )}
          {loop.sourceEpisode && <Citation episodeId={loop.sourceEpisode} />}
        </div>
      </div>
    </Card>
  );
}
