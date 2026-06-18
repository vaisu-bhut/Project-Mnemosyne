"use client";

import { Sparkles } from "lucide-react";
import { useChatPanel, type ChatContext } from "@/lib/chat/ChatPanelProvider";

/**
 * Floating bottom-right launcher that opens the page-context chat. Visible on
 * every page (mounted once in the ChatPanelProvider). Treated as the signature
 * "moment of the product": a quietly glowing pill with a soft halo, a refined
 * gradient surface, and an inner highlight that suggests depth without
 * crossing into ornamental.
 */
export function AskLauncher({ title, scope, suggestions, label = "Ask" }: ChatContext & { label?: string }) {
  const { open } = useChatPanel();
  return (
    <div className="fixed bottom-6 right-6 z-40">
      <button
        type="button"
        onClick={() => open({ title, scope, suggestions })}
        aria-label={title}
        className="
          btn-press relative inline-flex items-center gap-2
          rounded-full
          bg-primary text-primary-foreground
          px-5 py-2.5 text-[13px] font-semibold
          shadow-ink-deep
          ring-1 ring-primary/30
          hover:-translate-y-[1px]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
        "
      >
        <Sparkles className="size-3.5" />
        <span>{label}</span>
      </button>
    </div>
  );
}
