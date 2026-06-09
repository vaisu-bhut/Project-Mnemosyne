"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Link2, Plus, Trash2 } from "lucide-react";
import { useAccounts, useDisconnectAccount } from "@/hooks/useAccounts";
import { authApi } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import type { Account, OAuthProvider } from "@/lib/api/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/common/Spinner";

/** All services each provider offers, so we can show what's not yet granted. */
const ALL_SERVICES: Record<OAuthProvider, string[]> = {
  google: ["Gmail", "Calendar", "Contacts"],
  microsoft: ["Outlook Mail", "Calendar", "Contacts"],
};

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

async function startLink(provider: OAuthProvider, opts: { loginHint?: string } = {}) {
  try {
    const { url } =
      provider === "microsoft"
        ? await authApi.microsoftUrl({ intent: "link", ...opts })
        : await authApi.googleUrl({ intent: "link", ...opts });
    window.location.href = url; // same-tab; returns to /auth/<provider>/callback
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : "Couldn't start connect");
  }
}

export function ConnectedAccountsCard() {
  const accounts = useAccounts();
  const disconnect = useDisconnectAccount();
  const [busyId, setBusyId] = useState<string | null>(null);

  function onDisconnect(account: Account) {
    const label = account.email ?? account.displayName ?? "this account";
    if (!window.confirm(`Disconnect ${label}? Sources using it will fall back or fail at ingest.`)) {
      return;
    }
    setBusyId(account.id);
    disconnect.mutate(account.id, {
      onSuccess: () => toast.success(`Disconnected ${label}`),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Failed to disconnect"),
      onSettled: () => setBusyId(null),
    });
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" /> Connected accounts
        </CardTitle>
        <CardDescription>
          Google accounts linked to your memory, and which services each has granted. Add another
          account or grant more services to ingest more data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accounts.isLoading ? (
          <Spinner />
        ) : accounts.data && accounts.data.length > 0 ? (
          <ul className="space-y-3">
            {accounts.data.map((account) => {
              const granted = new Set(account.services.map((s) => s.label));
              const missing = (ALL_SERVICES[account.provider] ?? []).filter((s) => !granted.has(s));
              return (
                <li key={account.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {account.email ?? account.displayName ?? account.providerAccountId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {PROVIDER_LABEL[account.provider] ?? account.provider}
                      </p>
                    </div>
                    {account.needsReauth && (
                      <Badge variant="warning">
                        <AlertTriangle className="size-3" /> needs reauth
                      </Badge>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {account.services
                      .filter((s) => s.key !== "identity")
                      .map((s) => (
                        <Badge key={s.key} variant="secondary">
                          {s.label}
                        </Badge>
                      ))}
                    {missing.map((s) => (
                      <Badge key={s} variant="outline" className="text-muted-foreground">
                        {s} (not granted)
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void startLink(account.provider, { loginHint: account.email ?? undefined })
                      }
                    >
                      Add services
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDisconnect(account)}
                      disabled={busyId === account.id}
                    >
                      {busyId === account.id ? <Spinner /> : <Trash2 className="size-3.5" />}
                      Disconnect
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No accounts connected yet.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void startLink("google")}>
            <Plus className="size-4" /> Connect Google account
          </Button>
          <Button variant="outline" onClick={() => void startLink("microsoft")}>
            <Plus className="size-4" /> Connect Microsoft account
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
