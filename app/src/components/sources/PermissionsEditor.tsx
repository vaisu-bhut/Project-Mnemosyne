"use client";

import { Eye, ShieldCheck } from "lucide-react";

/**
 * Read-only by design. Mnemosyne ingests to build memory and never writes to or
 * deletes from your connected accounts — a deliberate trust constraint, stated
 * as a principle, not a missing feature. (The schema keeps dormant write/delete
 * columns for a possible future action layer; nothing acts on them today.)
 */
export function PermissionsEditor() {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <span className="text-sm font-medium">Read-only by design</span>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Eye className="mt-0.5 size-4 shrink-0" />
        Mnemosyne reads this source to build your memory. It never sends, edits,
        or deletes anything in your accounts — on purpose.
      </p>
    </div>
  );
}
