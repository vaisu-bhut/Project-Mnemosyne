"use client";

import { Sparkles } from "lucide-react";
import { useChatPanel, type ChatContext } from "@/lib/chat/ChatPanelProvider";

/**
 * Floating bottom-right launcher that opens the page-context chat. Drop it on
 * any page with the scope/suggestions describing that page's data.
 */
export function AskLauncher({ title, scope, suggestions, label = "Ask" }: ChatContext & { label?: string }) {
  const { open } = useChatPanel();
  return (
    <button
      type="button"
      onClick={() => open({ title, scope, suggestions })}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={title}
    >
      <Sparkles className="size-4" />
      {label}
    </button>
  );
}
