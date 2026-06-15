"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, briefingsApi } from "@/lib/api/endpoints";
import { mindKeys } from "@/hooks/useMind";
import { ensureNotifyPermission, notify } from "@/lib/notify";
import type { BlackboardEntry, UpcomingBriefing } from "@/lib/api/types";

const POLL_MS = 60_000;
// Only the things that earn an interruption.
const NUDGE_SALIENCE_FLOOR = 0.6;
// "It pings you ~15 min before" a meeting.
const BRIEFING_LEAD_MS = 15 * 60_000;
// Don't ping for a meeting that already started a while ago.
const BRIEFING_GRACE_MS = 2 * 60_000;

const STORAGE_KEY = "mnemosyne:notified";

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  try {
    // Cap growth so the key can't balloon over a long-lived session.
    const ids = Array.from(seen).slice(-500);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / unavailable storage
  }
}

/**
 * The Phase-2 "it pings you" delivery channel. Polls the blackboard (nudges)
 * and upcoming briefings; fires a browser notification for genuinely new,
 * salient items. Renders nothing. Mount once inside the authenticated shell.
 *
 * Dedup is persisted so reloads don't re-ping; on the very first run we seed a
 * baseline (record current items silently) so the user isn't hit by a backlog.
 */
export function ProactiveNotifier() {
  const seenRef = useRef<Set<string> | null>(null);
  const baselinedRef = useRef(false);

  // Lazily load the persisted seen-set, and detect a first-ever run.
  if (seenRef.current === null) {
    const existed = typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) !== null;
    seenRef.current = loadSeen();
    baselinedRef.current = existed; // already baselined in a prior session
  }

  useEffect(() => {
    void ensureNotifyPermission();
  }, []);

  const mind = useQuery({
    queryKey: [...mindKeys.all, 12],
    queryFn: () => agentsApi.mind(12),
    refetchInterval: POLL_MS,
  });
  const briefings = useQuery({
    queryKey: ["briefings", "upcoming", 24],
    queryFn: () => briefingsApi.upcoming(24),
    refetchInterval: POLL_MS,
  });

  // Nudges → notifications.
  useEffect(() => {
    const entries = mind.data;
    if (!entries) return;
    const seen = seenRef.current!;
    const salient = entries.filter(
      (e: BlackboardEntry) => e.status === "active" && e.salience >= NUDGE_SALIENCE_FLOOR,
    );

    // First-ever run: record what's already there without interrupting.
    if (!baselinedRef.current) {
      for (const e of salient) seen.add(`nudge:${e.id}`);
      baselinedRef.current = true;
      saveSeen(seen);
      return;
    }

    let changed = false;
    for (const e of salient) {
      const key = `nudge:${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changed = true;
      void notify(e.title, { body: e.body ?? undefined, tag: key, url: "/" });
    }
    if (changed) saveSeen(seen);
  }, [mind.data]);

  // Upcoming briefings → notifications ~15 min before the meeting.
  useEffect(() => {
    const items = briefings.data;
    if (!items) return;
    const seen = seenRef.current!;
    const now = Date.now();

    let changed = false;
    for (const b of items as UpcomingBriefing[]) {
      const key = `brief:${b.eventId}`;
      if (seen.has(key)) continue;
      const start = new Date(b.eventStart).getTime();
      const lead = start - now;
      if (lead > BRIEFING_LEAD_MS || lead < -BRIEFING_GRACE_MS) continue; // not in the window yet
      seen.add(key);
      changed = true;
      const name = b.briefing.name;
      void notify(`Briefing ready: ${b.eventTitle ?? name}`, {
        body: name ? `Meeting with ${name} starting soon — your briefing is ready.` : undefined,
        tag: key,
        url: "/briefings",
      });
    }
    if (changed) saveSeen(seen);
  }, [briefings.data]);

  return null;
}
