"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** Guardian retrieval mode (BACKEND.md §8). "external" is not exposed in the UI. */
export type Mode = "default" | "work" | "guest";

interface ModeState {
  mode: Mode;
  setMode: (mode: Mode) => void;
  includeSensitive: boolean;
  setIncludeSensitive: (value: boolean) => void;
}

const ModeContext = createContext<ModeState | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("default");
  const [includeSensitive, setIncludeSensitive] = useState(true);

  const value = useMemo(
    () => ({ mode, setMode, includeSensitive, setIncludeSensitive }),
    [mode, includeSensitive],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeState {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within ModeProvider");
  return ctx;
}
