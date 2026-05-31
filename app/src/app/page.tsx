import { Brain } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex items-center gap-3">
        <Brain className="size-8 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">Mnemosyne</h1>
      </div>
      <p className="max-w-md text-muted-foreground">
        Your proactive personal-memory system. Frontend scaffold is up — auth,
        sources, search/ask, and the agent mesh land in the following phases.
      </p>
    </main>
  );
}
