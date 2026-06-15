"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { Brain, SendHorizontal, Sparkles, X } from "lucide-react";
import { memoryApi } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { useEpisodeDrawer } from "@/components/episodes/EpisodeDrawerProvider";
import type { Answer, ChatMessage } from "@/lib/api/types";
import type { ChatContext } from "@/lib/chat/ChatPanelProvider";
import { AnswerText } from "@/components/AnswerText";
import { Citation } from "@/components/Citation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/common/Spinner";

interface Turn {
  question: string;
  answer?: Answer;
  error?: string;
}

/** Right slide-over chat that grounds answers in the active page's scope. */
export function ChatPanel({
  context,
  open,
  onOpenChange,
}: {
  context: ChatContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { register } = useEpisodeDrawer();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // A stable identity for the page-context; reset the thread when it changes.
  const ctxKey = context ? `${context.title}::${JSON.stringify(context.scope ?? {})}` : "";
  useEffect(() => {
    setTurns([]);
    setInput("");
  }, [ctxKey]);

  const ask = useMutation({
    mutationFn: ({ question, history }: { question: string; history: ChatMessage[] }) =>
      memoryApi.ask(question, { scope: context?.scope, history }),
  });

  // Autoscroll to the latest turn.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(raw: string) {
    const question = raw.trim();
    if (!question || ask.isPending) return;
    setInput("");
    // Prior completed turns become conversation history (LLM coherence only).
    const history: ChatMessage[] = turns.flatMap((t) =>
      t.answer
        ? [
            { role: "user" as const, content: t.question },
            { role: "assistant" as const, content: t.answer.answer },
          ]
        : [],
    );
    const idx = turns.length;
    setTurns((prev) => [...prev, { question }]);
    try {
      const answer = await ask.mutateAsync({ question, history });
      register(answer.used.episodes); // so citation chips can show detail
      setTurns((prev) => prev.map((t, i) => (i === idx ? { ...t, answer } : t)));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong";
      setTurns((prev) => prev.map((t, i) => (i === idx ? { ...t, error: message } : t)));
    }
  }

  const suggestions = context?.suggestions ?? [];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 flex h-svh w-full max-w-md flex-col border-l bg-background shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <DialogPrimitive.Title className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="size-4 text-primary" />
              {context?.title ?? "Ask your brain"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Ask questions answered from your memory, grounded in this page&apos;s data.
          </DialogPrimitive.Description>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {turns.length === 0 ? (
              <div className="flex flex-col items-center gap-4 pt-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <Brain className="size-6 text-primary" />
                </div>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Ask anything about this page&apos;s data. Answers are grounded in your memory
                  and cite their sources.
                </p>
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="rounded-full border bg-muted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              turns.map((t, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                      {t.question}
                    </p>
                  </div>
                  <div className="flex justify-start">
                    {t.answer ? (
                      <div className="max-w-[90%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
                        <div className="text-sm">
                          <AnswerText text={t.answer.answer} />
                        </div>
                        <CitationRow answer={t.answer} />
                      </div>
                    ) : t.error ? (
                      <p className="max-w-[90%] rounded-2xl rounded-bl-sm bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {t.error}
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                        <Spinner className="size-3" /> Thinking…
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2 border-t px-4 py-3"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              autoComplete="off"
            />
            <Button type="submit" size="icon" disabled={!input.trim() || ask.isPending}>
              {ask.isPending ? <Spinner /> : <SendHorizontal className="size-4" />}
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** De-duped source chips beneath an answer. */
function CitationRow({ answer }: { answer: Answer }) {
  const ids = Array.from(
    new Set(answer.citations.map((c) => c.episodeId).filter((id): id is string => Boolean(id))),
  );
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {ids.map((id) => (
        <Citation key={id} episodeId={id} />
      ))}
    </div>
  );
}
