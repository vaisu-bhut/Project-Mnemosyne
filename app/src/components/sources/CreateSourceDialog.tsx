"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCreateSource } from "@/hooks/useSources";
import { useAccounts } from "@/hooks/useAccounts";
import { DEFAULT_PERMISSIONS, type CreateSourceInput, type SourceKind, type SourcePermissions } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { KIND_META, SCOPE_OPTIONS } from "./kindMeta";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/common/Spinner";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const KINDS = Object.keys(KIND_META) as SourceKind[];

export function CreateSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<SourceKind>("filesystem");
  const [displayName, setDisplayName] = useState("");
  const [dir, setDir] = useState("examples/journal");
  const [scope, setScope] = useState<string>("personal");
  const [sensitive, setSensitive] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [permissions, setPermissions] = useState<SourcePermissions>(DEFAULT_PERMISSIONS);
  const create = useCreateSource();
  const accounts = useAccounts();

  const meta = KIND_META[kind];
  const providerAccounts = (accounts.data ?? []).filter((a) => a.provider === meta.oauth);

  // Default the account picker to the only matching account when there's just one.
  useEffect(() => {
    if (!meta.oauth) return;
    if (!accountId && providerAccounts.length === 1) setAccountId(providerAccounts[0]!.id);
  }, [meta.oauth, accountId, providerAccounts]);

  function reset() {
    setKind("filesystem");
    setDisplayName("");
    setDir("examples/journal");
    setScope("personal");
    setSensitive(false);
    setAccountId("");
    setPermissions(DEFAULT_PERMISSIONS);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim() || meta.label;
    if (kind === "filesystem" && !dir.trim()) {
      toast.error("A directory is required for a filesystem source.");
      return;
    }
    if (meta.oauth && !accountId) {
      toast.error("Choose which connected account this source pulls from.");
      return;
    }
    const input: CreateSourceInput = {
      kind,
      displayName: name,
      scope,
      sensitive,
      permissions,
      config: kind === "filesystem" ? { dir: dir.trim() } : {},
      ...(meta.oauth && accountId ? { oauthAccountId: accountId } : {}),
    };
    try {
      await create.mutateAsync(input);
      toast.success(`Added ${name}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add source");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New connector</DialogTitle>
          <DialogDescription>Connect a data stream to ingest into your memory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kind">Type</Label>
            <select
              id="kind"
              className={selectClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as SourceKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{meta.hint}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">Name</Label>
            <Input
              id="displayName"
              placeholder={meta.label}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          {kind === "filesystem" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dir">Directory</Label>
              <Input
                id="dir"
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                placeholder="examples/journal"
              />
              <p className="text-xs text-muted-foreground">
                Path on the backend host (relative to the API working directory).
              </p>
            </div>
          )}

          {meta.oauth && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account">Account</Label>
              {providerAccounts.length > 0 ? (
                <>
                  <select
                    id="account"
                    className={selectClass}
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a connected account…
                    </option>
                    {providerAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.email ?? a.displayName ?? a.providerAccountId}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Which connected {meta.oauth === "microsoft" ? "Microsoft" : "Google"} account
                    this source ingests from.
                  </p>
                </>
              ) : (
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  No {meta.oauth === "microsoft" ? "Microsoft" : "Google"} account connected.
                  Connect one in the Connected accounts section above first.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scope">Scope</Label>
              <select
                id="scope"
                className={selectClass}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
              />
              Sensitive
            </label>
          </div>

          <PermissionsEditor value={permissions} onChange={setPermissions} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Add source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
