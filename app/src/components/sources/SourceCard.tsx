"use client";

import { AlertTriangle, RefreshCw, Settings2 } from "lucide-react";
import type { Source } from "@/lib/api/types";
import { KIND_META } from "./kindMeta";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/common/Spinner";

export function SourceCard({
  source,
  ingesting,
  onIngest,
  onEdit,
}: {
  source: Source;
  ingesting: boolean;
  onIngest: (source: Source) => void;
  onEdit: (source: Source) => void;
}) {
  const meta = KIND_META[source.kind] ?? KIND_META.filesystem;
  const Icon = meta.icon;
  const needsReauth = source.config?.needsReauth === true;
  const dir = typeof source.config?.dir === "string" ? source.config.dir : null;

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
        {ingesting && (
          <Badge variant="secondary" className="shrink-0">
            <Spinner className="size-3" /> Ingesting
          </Badge>
        )}
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

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onIngest(source)}
          disabled={ingesting}
        >
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
