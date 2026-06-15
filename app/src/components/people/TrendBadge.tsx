"use client";

import { TrendingDown, TrendingUp, Minus, type LucideIcon } from "lucide-react";
import type { RelationshipTrend } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const TREND: Record<RelationshipTrend, { icon: LucideIcon; label: string; className: string }> = {
  warming: {
    icon: TrendingUp,
    label: "warming",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  cooling: {
    icon: TrendingDown,
    label: "cooling",
    className: "text-amber-600 dark:text-amber-400",
  },
  steady: { icon: Minus, label: "steady", className: "text-muted-foreground" },
};

/** Contact-cadence trend: are you talking more, the same, or less than before? */
export function TrendBadge({
  trend,
  title,
  className,
}: {
  trend: RelationshipTrend;
  title?: string;
  className?: string;
}) {
  const t = TREND[trend];
  const Icon = t.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs font-medium", t.className, className)}
      title={title ?? "Contact cadence vs. the prior 2 months"}
    >
      <Icon className="size-3.5" />
      {t.label}
    </span>
  );
}
