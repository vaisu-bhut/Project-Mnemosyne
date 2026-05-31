"use client";

import Link from "next/link";
import { User } from "lucide-react";
import type { RelationshipHealth } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pct } from "@/lib/format";

export function PersonCard({
  person,
  staleDays = 30,
}: {
  person: RelationshipHealth;
  staleDays?: number;
}) {
  const cold = person.daysSinceContact !== null && person.daysSinceContact > staleDays;
  const contact =
    person.daysSinceContact === null
      ? "no recorded contact"
      : person.daysSinceContact === 0
        ? "today"
        : `${person.daysSinceContact}d ago`;

  return (
    <Link href={`/people/${person.entityId}`} className="block">
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:bg-accent/40">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-muted">
            <User className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{person.name}</p>
            <p className="text-xs text-muted-foreground">
              {person.interactions} interaction{person.interactions === 1 ? "" : "s"} · {contact}
            </p>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {person.closeness !== null && (
            <Badge variant="secondary" title="closeness">
              {pct(person.closeness)} close
            </Badge>
          )}
          {cold && <Badge variant="warning">going cold</Badge>}
        </div>
      </Card>
    </Link>
  );
}
