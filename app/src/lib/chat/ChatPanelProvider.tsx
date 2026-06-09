"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChatScope } from "@/lib/api/types";
import { ChatPanel } from "@/components/chat/ChatPanel";

/** The page context a chat is opened with — drives the title + scoped retrieval. */
export interface ChatContext {
  /** e.g. "Ask about Sara Lin" or "Ask your memory". */
  title: string;
  /** Biases retrieval to this page's data (person/source/kind). */
  scope?: ChatScope;
  /** Optional starter prompts shown on the empty thread. */
  suggestions?: string[];
}

interface ChatPanelApi {
  open: (ctx: ChatContext) => void;
  close: () => void;
}

const ChatPanelContext = createContext<ChatPanelApi | null>(null);

/**
 * App-wide host for the "ask your brain" slide-over. Pages mount an
 * <AskLauncher/> that calls open(ctx); the panel grounds each answer in the
 * page's scope via the existing retrieval-based /ask.
 */
export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<ChatContext | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback((ctx: ChatContext) => {
    setContext(ctx);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const api = useMemo<ChatPanelApi>(() => ({ open, close }), [open, close]);

  return (
    <ChatPanelContext.Provider value={api}>
      {children}
      <ChatPanel context={context} open={isOpen} onOpenChange={setIsOpen} />
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel(): ChatPanelApi {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) throw new Error("useChatPanel must be used within ChatPanelProvider");
  return ctx;
}
