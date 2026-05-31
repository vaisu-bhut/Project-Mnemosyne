"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EpisodeHit } from "@/lib/api/types";
import { EpisodeDrawer } from "./EpisodeDrawer";

interface EpisodeDrawerApi {
  /** Open the drawer for a source episode (looked up in the registry for detail). */
  open: (episodeId: string | null) => void;
  /** Make episode hits known so citations elsewhere can render their detail. */
  register: (episodes: EpisodeHit[]) => void;
}

const EpisodeDrawerContext = createContext<EpisodeDrawerApi | null>(null);

/** App-wide host for the "verify on click" episode drawer. Citations anywhere
 * call open(episodeId); pages register the episode hits they fetch. */
export function EpisodeDrawerProvider({ children }: { children: ReactNode }) {
  const registry = useRef(new Map<string, EpisodeHit>());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [hit, setHit] = useState<EpisodeHit | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Resolve the episode detail in the event handler (ref reads are fine here),
  // then hold it in state so render never touches the ref.
  const open = useCallback((id: string | null) => {
    if (!id) return;
    setCurrentId(id);
    setHit(registry.current.get(id) ?? null);
    setIsOpen(true);
  }, []);

  const register = useCallback((episodes: EpisodeHit[]) => {
    for (const e of episodes) registry.current.set(e.id, e);
  }, []);

  const api = useMemo<EpisodeDrawerApi>(() => ({ open, register }), [open, register]);

  return (
    <EpisodeDrawerContext.Provider value={api}>
      {children}
      <EpisodeDrawer
        episodeId={currentId}
        hit={hit}
        open={isOpen}
        onOpenChange={setIsOpen}
        onForgotten={(id) => registry.current.delete(id)}
      />
    </EpisodeDrawerContext.Provider>
  );
}

export function useEpisodeDrawer(): EpisodeDrawerApi {
  const ctx = useContext(EpisodeDrawerContext);
  if (!ctx) throw new Error("useEpisodeDrawer must be used within EpisodeDrawerProvider");
  return ctx;
}
