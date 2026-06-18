"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

const PAGE_LABELS: Array<[match: RegExp | string, label: string]> = [
  [/^\/people\/[^/]+$/, "People · Profile"],
  ["/memory", "Memory"],
  ["/sources", "Connections"],
  ["/people", "People"],
  ["/briefings", "Briefings"],
  ["/open-loops", "Open Loops"],
  ["/settings", "Settings"],
  ["/", "Dashboard"],
];

function labelFor(pathname: string): string {
  for (const [m, label] of PAGE_LABELS) {
    if (typeof m === "string" ? pathname === m || pathname.startsWith(`${m}/`) : m.test(pathname)) {
      return label;
    }
  }
  return "Dashboard";
}

/**
 * Quiet context strip. The Capture action has moved into the sidebar (where the
 * primary verb belongs); identity lives in the sidebar too. The topbar's only
 * job now is to name the current page — small caps with a kicker dot — and
 * carry the hairline that separates chrome from content.
 */
export function Topbar() {
  const pathname = usePathname();
  const page = useMemo(() => labelFor(pathname), [pathname]);

  return (
    <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-sm">
      <div className="flex h-10 items-center px-5 md:px-7">
        <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--ochre)]" />
          {page}
        </p>
      </div>
      <div aria-hidden className="h-px w-full bg-border" />
    </header>
  );
}
