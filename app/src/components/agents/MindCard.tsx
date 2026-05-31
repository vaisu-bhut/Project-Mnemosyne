"use client";

import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Bell, CalendarClock, Sparkles, X, type LucideIcon } from "lucide-react";
import type { BlackboardEntry } from "@/lib/api/types";
import { useDismissMind } from "@/hooks/useMind";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KIND_ICON: Record<string, LucideIcon> = {
  nudge: Bell,
  alert: AlertTriangle,
  briefing: CalendarClock,
};

export function MindCard({ entry }: { entry: BlackboardEntry }) {
  const dismiss = useDismissMind();
  const Icon = KIND_ICON[entry.kind] ?? Sparkles;

  return (
    <Card className="flex items-start gap-3 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{entry.title}</p>
        {entry.body && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{entry.body}</p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <Badge variant="outline" className="capitalize">
            {entry.agent}
          </Badge>
          {entry.entityId && (
            <Link
              href={`/people/${entry.entityId}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              View person
            </Link>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        title="Dismiss"
        onClick={() =>
          dismiss.mutate(entry.id, { onError: () => toast.error("Failed to dismiss") })
        }
      >
        <X className="size-4" />
      </Button>
    </Card>
  );
}
