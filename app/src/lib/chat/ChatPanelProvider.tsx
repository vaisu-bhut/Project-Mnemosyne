"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChatScope } from "@/lib/api/types";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { AskLauncher } from "@/components/chat/AskLauncher";

/** The page context a chat is opened with — drives the title + scoped retrieval. */
export interface ChatContext {
  /** e.g. "Ask about Sara Lin" or "Ask your memory". */
  title: string;
  /** Biases retrieval to this page's data (person/source/kind). */
  scope?: ChatScope;
  /** Optional starter prompts shown on the empty thread. */
  suggestions?: string[];
}

/** Fallback context for pages that don't register one of their own. */
const DEFAULT_CONTEXT: ChatContext = {
  title: "Ask your memory",
  suggestions: [
    "What's on my plate today?",
    "Who should I follow up with?",
    "What did I learn this week?",
  ],
};

interface ChatPanelApi {
  /** Open the panel. With no argument, opens with the active page's context. */
  open: (ctx?: ChatContext) => void;
  close: () => void;
  /** A page registers the scope/suggestions the ubiquitous launcher should use. */
  setPageContext: (ctx: ChatContext | null) => void;
}

const ChatPanelContext = createContext<ChatPanelApi | null>(null);

/**
 * App-wide host for the "ask your brain" slide-over. The launcher lives here so
 * Ask is available on every page; pages call useRegisterChatContext() to bias
 * retrieval to their data. Each answer is grounded via the existing /ask.
 */
export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<ChatContext | null>(null);
  const [pageContext, setPageContext] = useState<ChatContext | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(
    (ctx?: ChatContext) => {
      setContext(ctx ?? pageContext ?? DEFAULT_CONTEXT);
      setIsOpen(true);
    },
    [pageContext],
  );
  const close = useCallback(() => setIsOpen(false), []);

  const api = useMemo<ChatPanelApi>(
    () => ({ open, close, setPageContext }),
    [open, close],
  );

  const launcher = pageContext ?? DEFAULT_CONTEXT;

  return (
    <ChatPanelContext.Provider value={api}>
      {children}
      <AskLauncher
        title={launcher.title}
        scope={launcher.scope}
        suggestions={launcher.suggestions}
      />
      <ChatPanel context={context} open={isOpen} onOpenChange={setIsOpen} />
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel(): ChatPanelApi {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) throw new Error("useChatPanel must be used within ChatPanelProvider");
  return ctx;
}

/**
 * Register this page's chat context with the ubiquitous launcher for as long as
 * the page is mounted. The launcher reverts to the default on unmount. Pass a
 * stable object (memoize if it carries dynamic fields).
 */
export function useRegisterChatContext(ctx: ChatContext): void {
  const { setPageContext } = useChatPanel();
  const key = JSON.stringify(ctx);
  useEffect(() => {
    setPageContext(ctx);
    return () => setPageContext(null);
    // key captures the meaningful contents of ctx; ctx itself may be a fresh ref each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setPageContext]);
}
