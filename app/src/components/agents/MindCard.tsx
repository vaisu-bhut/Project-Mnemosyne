"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Clock,
  Scale,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import type { BlackboardEntry } from "@/lib/api/types";
import { useDismissMind, useSnoozeMind } from "@/hooks/useMind";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KIND_ICON: Record<string, LucideIcon> = {
  nudge: Bell,
  alert: AlertTriangle,
  briefing: CalendarClock,
  commitment: CalendarClock,
  contradiction: Scale,
};

const KIND_STYLE: Record<string, { border: string; icon: string }> = {
  nudge: { border: "border-l-primary/40", icon: "text-primary" },
  alert: { border: "border-l-destructive/50", icon: "text-destructive" },
  briefing: { border: "border-l-indigo-500/40", icon: "text-indigo-400" },
  commitment: { border: "border-l-indigo-500/40", icon: "text-indigo-400" },
  contradiction: { border: "border-l-amber-500/40", icon: "text-amber-400" },
};

const SNOOZE_OPTIONS: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "1d", hours: 24 },
  { label: "1w", hours: 168 },
];

export function MindCard({ entry }: { entry: BlackboardEntry }) {
  const dismiss = useDismissMind();
  const snooze = useSnoozeMind();
  const [showSnooze, setShowSnooze] = useState(false);
  const Icon = KIND_ICON[entry.kind] ?? Sparkles;
  const style = KIND_STYLE[entry.kind] ?? { border: "border-l-primary/40", icon: "text-primary" };
  const busy = dismiss.isPending || snooze.isPending;

  return (
    <Card className={`card-hover relative overflow-hidden flex items-start gap-3 p-3 border-l-[3px] ${style.border}`}>
      <div className="absolute inset-0 bg-gradient-to-r from-background/20 to-transparent pointer-events-none" />
      <Icon className={`relative z-10 mt-0.5 size-4 shrink-0 ${style.icon}`} />
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
          {showSnooze && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Snooze</span>
              {SNOOZE_OPTIONS.map((o) => (
                <button
                  key={o.hours}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    snooze.mutate(
                      { id: entry.id, hours: o.hours },
                      {
                        onSuccess: () => toast.success(`Snoozed for ${o.label}`),
                        onError: () => toast.error("Failed to snooze"),
                      },
                    )
                  }
                  className="rounded border px-1.5 py-0.5 font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  {o.label}
                </button>
              ))}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Snooze"
          disabled={busy}
          onClick={() => setShowSnooze((s) => !s)}
        >
          <Clock className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Dismiss"
          disabled={busy}
          onClick={() =>
            dismiss.mutate(entry.id, { onError: () => toast.error("Failed to dismiss") })
          }
        >
          <X className="size-4" />
        </Button>
      </div>
    </Card>
  );
}
