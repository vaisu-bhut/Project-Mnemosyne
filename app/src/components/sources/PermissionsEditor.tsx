"use client";

import type { SourcePermissions } from "@/lib/api/types";

/**
 * Per-app permission editor. `read` is always on (ingestion is how memory is
 * built); `write`/`delete` are DEFINITIONS for the future write/action layer
 * — selectable + saved, but not executed yet. "delete" = deleting data at the
 * source (an email, a note), never deleting memory.
 */
export function PermissionsEditor({
  value,
  onChange,
}: {
  value: SourcePermissions;
  onChange: (next: SourcePermissions) => void;
}) {
  const set = (patch: Partial<SourcePermissions>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-2.5 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Permissions</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          write/delete coming soon
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" className="size-4 accent-primary" checked readOnly disabled />
        Read — ingest data into memory (always on)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={value.write}
          onChange={(e) => set({ write: e.target.checked })}
        />
        Write — create/update data at the source
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={value.delete}
          onChange={(e) => set({ delete: e.target.checked })}
        />
        Delete — delete data at the source (e.g. an email, a note)
      </label>

      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm">Write mode</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={value.mode}
          onChange={(e) => set({ mode: e.target.value as SourcePermissions["mode"] })}
          disabled={!value.write && !value.delete}
        >
          <option value="approval">Ask me first (approval)</option>
          <option value="autonomous">Autonomous (direct)</option>
        </select>
      </div>
    </div>
  );
}
