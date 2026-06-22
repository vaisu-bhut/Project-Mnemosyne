"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Mic,
  Plug,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { VoiceCaptureDialog } from "@/components/capture/VoiceCaptureDialog";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/memory", label: "Memory", icon: ScrollText },
  { href: "/app/sources", label: "Connections", icon: Plug },
  { href: "/app/people", label: "People", icon: Users },
  { href: "/app/briefings", label: "Briefings", icon: CalendarClock },
  { href: "/app/open-loops", label: "Open Loops", icon: ListChecks },
  { href: "/app/settings", label: "Settings", icon: Settings },
] as const;

/**
 * Editorial left rail — four zones, each doing one thing well:
 *
 *   1. Brand        — wordmark only (serif italic), no icon. The product is
 *                     the typography.
 *   2. Capture CTA  — full-width primary action. The most important verb in
 *                     the app, given the most visible position.
 *   3. Nav          — the active item carries an ochre left border (inside
 *                     the row, not floating outside it).
 *   4. Identity     — bottom-anchored single line.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [captureOpen, setCaptureOpen] = useState(false);
  const who = user?.displayName ?? user?.email ?? "";
  const initial = who.trim()[0]?.toUpperCase() ?? "·";

  return (
    <aside
      className="
        fixed inset-y-0 left-0 z-30 hidden
        w-56 flex-col
        border-r border-border
        bg-sidebar
        md:flex
      "
      aria-label="Primary navigation"
    >
      <VoiceCaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} />

      {/* Brand — type only. */}
      <div className="flex h-12 items-center px-5">
        <Link
          href="/app"
          className="text-serif text-[19px] font-semibold italic leading-none tracking-tight text-foreground"
        >
          Mnemosyne
        </Link>
      </div>
      <div aria-hidden className="h-px bg-border" />

      {/* Navigation — fills the middle so Capture + identity sit at the bottom. */}
      <nav className="flex flex-1 flex-col gap-[1px] overflow-y-auto px-3 py-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
                active
                  ? "bg-accent font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[var(--ochre)] transition-opacity duration-200",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon
                className={cn(
                  "size-[15px] transition-colors duration-150",
                  active ? "text-foreground" : "text-muted-foreground/85 group-hover:text-foreground",
                )}
                strokeWidth={1.75}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Capture — primary CTA, bottom-anchored above identity. */}
      <div aria-hidden className="h-px bg-border" />
      <div className="px-3 py-2.5">
        <Button
          onClick={() => setCaptureOpen(true)}
          className="btn-press h-9 w-full justify-center gap-1.5 text-[13px]"
        >
          <Mic className="size-3.5" /> Capture
        </Button>
      </div>

      {/* Identity — bottom-anchored single line. */}
      <div aria-hidden className="h-px bg-border" />
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary ring-1 ring-primary/20"
        >
          {initial}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12px] text-foreground"
          title={who}
        >
          {who || "Signed in"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void logout()}
          title="Sign out"
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-3.5" />
        </Button>
      </div>
    </aside>
  );
}
