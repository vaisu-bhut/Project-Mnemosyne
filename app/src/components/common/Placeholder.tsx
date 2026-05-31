import { Construction } from "lucide-react";

/** Stub for routes whose UI lands in a later build phase. */
export function Placeholder({ phase }: { phase: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-muted-foreground">
      <Construction className="size-6" />
      <p className="text-sm">Lands in {phase}.</p>
    </div>
  );
}
