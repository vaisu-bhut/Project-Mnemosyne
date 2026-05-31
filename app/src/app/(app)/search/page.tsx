"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Search, Sparkles } from "lucide-react";
import { useMode } from "@/lib/mode/ModeProvider";
import { useEpisodeDrawer } from "@/components/episodes/EpisodeDrawerProvider";
import { useAsk, useSearch } from "@/hooks/useRetrieve";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { Spinner } from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { SearchResults } from "@/components/search/SearchResults";
import { AnswerView } from "@/components/search/AnswerView";
import { cn } from "@/lib/utils";

type Tab = "search" | "ask";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function SearchPage() {
  const { mode, includeSensitive } = useMode();
  const { register } = useEpisodeDrawer();
  const search = useSearch();
  const ask = useAsk();

  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [k, setK] = useState(8);

  const pending = tab === "search" ? search.isPending : ask.isPending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const opts = { k, mode, includeSensitive };
    const onError = (err: unknown) =>
      toast.error(err instanceof ApiError ? err.message : "Request failed");

    if (tab === "search") {
      search.mutate({ query: q, opts }, { onSuccess: (d) => register(d.episodes), onError });
    } else {
      ask.mutate({ question: q, opts }, { onSuccess: (d) => register(d.used.episodes), onError });
    }
  }

  return (
    <>
      <PageHeader
        title="Search & Ask"
        description="Cited recall over your memory — every claim links to its source."
      />

      <Card className="mb-6 p-4">
        <div className="mb-3 inline-flex rounded-md border p-0.5">
          <TabButton active={tab === "search"} onClick={() => setTab("search")} icon={Search}>
            Search
          </TabButton>
          <TabButton active={tab === "ask"} onClick={() => setTab("ask")} icon={Sparkles}>
            Ask
          </TabButton>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder={
              tab === "search" ? "Search your memory…" : "Ask a question about your memory…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <select
              className={selectClass}
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
              title="Max results"
            >
              {[5, 8, 15, 25].map((n) => (
                <option key={n} value={n}>
                  k={n}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending || !query.trim()}>
              {pending ? <Spinner /> : tab === "search" ? <Search /> : <Sparkles />}
              {tab === "search" ? "Search" : "Ask"}
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Guardian mode: <span className="font-medium">{mode}</span>
          {!includeSensitive && " · sensitive hidden"} (change in the top bar)
        </p>
      </Card>

      {tab === "search" ? (
        pending ? (
          <CenteredSpinner />
        ) : search.data ? (
          <SearchResults result={search.data} />
        ) : (
          <Hint text="Run a search to see cited facts, episodes, and entities." />
        )
      ) : pending ? (
        <CenteredSpinner />
      ) : ask.data ? (
        <AnswerView answer={ask.data} />
      ) : (
        <Hint text="Ask a question to get a grounded answer with citations." />
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Search;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function CenteredSpinner() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div className="flex min-h-[30vh] items-center justify-center text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
