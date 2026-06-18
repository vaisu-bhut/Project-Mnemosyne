import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

/** Full-area centered spinner for route/loading states. */
export function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-subtle-pulse" />
        <Loader2 className="relative size-7 animate-spin text-primary" />
      </div>
    </div>
  );
}
