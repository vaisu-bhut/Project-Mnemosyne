"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useClassifySource } from "@/hooks/useSources";
import { DEFAULT_PERMISSIONS, type Source } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { SCOPE_OPTIONS } from "./kindMeta";
import { PermissionsEditor } from "./PermissionsEditor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/common/Spinner";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ClassifySourceDialog({
  source,
  open,
  onOpenChange,
}: {
  source: Source | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        {source && (
          <ClassifyForm key={source.id} source={source} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Inner form: state is initialized from props on mount (keyed by source.id),
// so no effect-driven syncing is needed.
function ClassifyForm({ source, onDone }: { source: Source; onDone: () => void }) {
  const [scope, setScope] = useState(source.scope);
  const [sensitive, setSensitive] = useState(source.sensitive);
  const classify = useClassifySource();

  const scopeOptions = SCOPE_OPTIONS.includes(scope as (typeof SCOPE_OPTIONS)[number])
    ? SCOPE_OPTIONS
    : [scope, ...SCOPE_OPTIONS];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await classify.mutateAsync({
        id: source.id,
        input: { scope, sensitive, permissions: DEFAULT_PERMISSIONS },
      });
      toast.success("Connector settings updated");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connector settings</DialogTitle>
        <DialogDescription>
          {source.displayName} — Guardian visibility and per-app permissions.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-scope">Scope</Label>
          <select
            id="edit-scope"
            className={selectClass}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            {scopeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={sensitive}
            onChange={(e) => setSensitive(e.target.checked)}
          />
          Sensitive (encrypted at rest; hidden in guest mode)
        </label>
        <PermissionsEditor />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={classify.isPending}>
            {classify.isPending && <Spinner />}
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
