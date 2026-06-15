"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMergePeople } from "@/hooks/usePeople";
import { ApiError } from "@/lib/api/client";
import type { RelationshipHealth } from "@/lib/api/types";
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

/** "These two are the same person." Folds the duplicate into the one you keep —
 * aliases, facts, edges, and open loops move over; the duplicate is removed. */
export function MergePeopleDialog({
  people,
  open,
  onOpenChange,
}: {
  people: RelationshipHealth[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [survivorId, setSurvivorId] = useState("");
  const [dupeId, setDupeId] = useState("");
  const merge = useMergePeople();

  const survivor = people.find((p) => p.entityId === survivorId);
  const dupe = people.find((p) => p.entityId === dupeId);
  const valid = survivorId && dupeId && survivorId !== dupeId;

  function reset() {
    setSurvivorId("");
    setDupeId("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error("Pick two different people.");
      return;
    }
    try {
      await merge.mutateAsync({ survivorId, dupeId });
      toast.success(`Merged ${dupe?.name} into ${survivor?.name}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to merge");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge people</DialogTitle>
          <DialogDescription>
            Combine two entries the system wrongly split into one person. This can&apos;t be undone
            automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="survivor">Keep</Label>
            <select
              id="survivor"
              className={selectClass}
              value={survivorId}
              onChange={(e) => setSurvivorId(e.target.value)}
            >
              <option value="" disabled>
                Select the person to keep…
              </option>
              {people.map((p) => (
                <option key={p.entityId} value={p.entityId} disabled={p.entityId === dupeId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dupe">Merge &amp; remove</Label>
            <select
              id="dupe"
              className={selectClass}
              value={dupeId}
              onChange={(e) => setDupeId(e.target.value)}
            >
              <option value="" disabled>
                Select the duplicate to fold in…
              </option>
              {people.map((p) => (
                <option key={p.entityId} value={p.entityId} disabled={p.entityId === survivorId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {valid && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <strong className="text-foreground">{dupe?.name}</strong> will be folded into{" "}
              <strong className="text-foreground">{survivor?.name}</strong> and removed.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || merge.isPending}>
              {merge.isPending && <Spinner />}
              Merge
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
