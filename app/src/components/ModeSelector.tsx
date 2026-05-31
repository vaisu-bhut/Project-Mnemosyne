"use client";

import { ShieldCheck } from "lucide-react";
import { useMode, type Mode } from "@/lib/mode/ModeProvider";

const MODES: { value: Mode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "work", label: "Work" },
  { value: "guest", label: "Guest" },
];

/** Guardian retrieval mode + sensitive toggle, applied to search/ask/conduct. */
export function ModeSelector() {
  const { mode, setMode, includeSensitive, setIncludeSensitive } = useMode();

  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5 text-muted-foreground">
        <ShieldCheck className="size-4" />
        <span className="hidden sm:inline">Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="h-8 rounded-md border border-input bg-background px-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-muted-foreground">
        <input
          type="checkbox"
          checked={includeSensitive}
          onChange={(e) => setIncludeSensitive(e.target.checked)}
          className="size-4 accent-primary"
        />
        <span className="hidden sm:inline">Sensitive</span>
      </label>
    </div>
  );
}
