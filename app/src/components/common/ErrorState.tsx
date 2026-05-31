import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
      <AlertTriangle className="size-7 text-destructive" />
      <p className="max-w-sm text-sm text-muted-foreground">
        {message ?? "Something went wrong."}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
