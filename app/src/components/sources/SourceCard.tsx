"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Settings2, XCircle } from "lucide-react";
import type { Source } from "@/lib/api/types";
import { useIngestStatus } from "@/hooks/useSources";
import { KIND_META } from "./kindMeta";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/common/Spinner";

// Keep a finished run visible briefly before the parent clears the active flag.
const SETTLE_MS = 2500;

export function SourceCard({
  source,
  active,
  onIngest,
  onEdit,
  onSettled,
}: {
  source: Source;
  /** True from clicking Ingest until the run settles (drives live polling). */
  active: boolean;
  onIngest: (source: Source) => void;
  onEdit: (source: Source) => void;
  onSettled: (sourceId: string) => void;
}) {
  const meta = KIND_META[source.kind] ?? KIND_META.filesystem;
  const Icon = meta.icon;
  const needsReauth = source.config?.needsReauth === true;
  const dir = typeof source.config?.dir === "string" ? source.config.dir : null;

  const status = useIngestStatus(source.id, active);
  const run = status.data;
  const finished = run?.status === "done" || run?.status === "error";
  const ingesting = active && !finished;

  // Once the run finishes, let the result linger, then hand back to the parent.
  useEffect(() => {
    if (!active || !finished) return;
    const t = setTimeout(() => onSettled(source.id), SETTLE_MS);
    return () => clearTimeout(t);
  }, [active, finished, source.id, onSettled]);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-muted">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{source.displayName}</p>
            <p className="text-xs text-muted-foreground">
              {meta.label}
              {dir && <span className="font-mono"> · {dir}</span>}
            </p>
          </div>
        </div>
        {ingesting ? (
          <Badge variant="secondary" className="shrink-0">
            <Spinner className="size-3" />
            {run?.status === "running" && run.total != null
              ? `Ingesting ${run.ingested}/${run.total}`
              : "Ingesting"}
          </Badge>
        ) : active && run?.status === "done" ? (
          <Badge variant="secondary" className="shrink-0">
            <CheckCircle2 className="size-3 text-emerald-600" /> Ingested {run.ingested}
          </Badge>
        ) : active && run?.status === "error" ? (
          <Badge variant="destructive" className="shrink-0">
            <XCircle className="size-3" /> Failed
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{source.scope}</Badge>
        {source.sensitive && <Badge variant="destructive">sensitive</Badge>}
        {needsReauth && (
          <Badge variant="warning">
            <AlertTriangle className="size-3" /> needs reauth
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Read-only · never writes to your account</p>

      {/* Live ingestion feed: a rolling sample of what's being pulled in. */}
      {active && run && (run.items.length > 0 || run.status === "error") && (
        <div className="rounded-md border bg-muted/40 p-2 text-xs">
          {run.status === "error" ? (
            <p className="text-destructive">{run.error ?? "Ingestion failed."}</p>
          ) : (
            <ul className="space-y-1">
              {run.items.slice(0, 5).map((item, i) => (
                <li key={i} className="flex items-center gap-1.5 truncate text-muted-foreground">
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] uppercase">
                    {item.kind}
                  </span>
                  <span className="truncate">{item.title ?? "(untitled)"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={() => onIngest(source)} disabled={ingesting}>
          <RefreshCw className={ingesting ? "animate-spin" : undefined} />
          Ingest
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onEdit(source)}>
          <Settings2 />
          Edit
        </Button>
      </div>
    </Card>
  );
}
