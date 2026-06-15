"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/common/PageHeader";
import { EpisodesTab } from "@/components/memory/EpisodesTab";
import { FactsTab } from "@/components/memory/FactsTab";
import { ContradictionsTab } from "@/components/memory/ContradictionsTab";
import { useRegisterChatContext } from "@/lib/chat/ChatPanelProvider";

type Tab = "episodes" | "facts" | "conflicts";
const TABS: { value: Tab; label: string }[] = [
  { value: "episodes", label: "Episodes" },
  { value: "facts", label: "Facts" },
  { value: "conflicts", label: "Conflicts" },
];

const CHAT_CONTEXT = {
  title: "Ask your memory",
  suggestions: [
    "What happened recently?",
    "What do you know about me?",
    "What are my commitments?",
  ],
};

export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>("episodes");
  useRegisterChatContext(CHAT_CONTEXT);

  return (
    <>
      <PageHeader
        title="Memory"
        description="Everything ingested (episodes) and everything learned (facts)."
      />

      <div className="mb-4 inline-flex rounded-md border bg-muted/40 p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "episodes" ? (
        <EpisodesTab />
      ) : tab === "facts" ? (
        <FactsTab />
      ) : (
        <ContradictionsTab />
      )}
    </>
  );
}
