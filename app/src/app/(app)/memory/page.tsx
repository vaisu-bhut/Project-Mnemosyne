"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/common/PageHeader";
import { EpisodesTab } from "@/components/memory/EpisodesTab";
import { FactsTab } from "@/components/memory/FactsTab";
import { AskLauncher } from "@/components/chat/AskLauncher";

type Tab = "episodes" | "facts";

export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>("episodes");

  return (
    <>
      <PageHeader
        title="Memory"
        description="Everything ingested (episodes) and everything learned (facts)."
      />

      <div className="mb-4 inline-flex rounded-md border bg-muted/40 p-1">
        {(["episodes", "facts"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "episodes" ? <EpisodesTab /> : <FactsTab />}

      <AskLauncher
        title="Ask your memory"
        suggestions={[
          "What happened recently?",
          "What do you know about me?",
          "What are my commitments?",
        ]}
      />
    </>
  );
}
