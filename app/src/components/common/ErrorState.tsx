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
    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center backdrop-blur-md">
      <div className="rounded-full bg-destructive/15 p-3">
        <AlertTriangle className="size-6 text-destructive" />
      </div>
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
