import type {
  Connector,
  Participant,
  PullOptions,
  PullResult,
  RawItem,
} from "./connector.js";
import { fetchWithRetry } from "../util/http.js";

const CAL_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export interface CalendarConnectorOptions {
  accessToken: string;
  daysPast?: number;
  daysFuture?: number;
  maxEvents?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  now?: Date;
}

interface CalAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
  organizer?: boolean;
}
interface CalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: CalAttendee;
  attendees?: CalAttendee[];
}

function startDate(ev: CalEvent): Date {
  const s = ev.start?.dateTime ?? ev.start?.date;
  return s ? new Date(s) : new Date();
}

/** Attendees (excluding yourself) + organizer become participants. */
function participantsOf(ev: CalEvent): Participant[] {
  const out: Participant[] = [];
  if (ev.organizer && !ev.organizer.self && ev.organizer.email) {
    out.push({ email: ev.organizer.email.toLowerCase(), name: ev.organizer.displayName, role: "from" });
  }
  for (const a of ev.attendees ?? []) {
    if (a.self || !a.email) continue;
    out.push({ email: a.email.toLowerCase(), name: a.displayName, role: "to" });
  }
  return out;
}

function toRawItem(ev: CalEvent): RawItem {
  const body = [ev.location && `Location: ${ev.location}`, ev.description]
    .filter(Boolean)
    .join("\n\n");
  return {
    externalId: ev.id,
    occurredAt: startDate(ev),
    kind: "calendar_event",
    title: ev.summary ?? "(untitled event)",
    body,
    raw: Buffer.from(JSON.stringify(ev)),
    contentType: "application/json",
    participants: participantsOf(ev),
    meta: {
      start: ev.start?.dateTime ?? ev.start?.date ?? null,
      end: ev.end?.dateTime ?? ev.end?.date ?? null,
      location: ev.location ?? null,
    },
  };
}

/**
 * Google Calendar connector. First run lists events in a window
 * [now-daysPast, now+daysFuture] and records a syncToken; later runs sync
 * incrementally from that token, falling back to a full window resync if the
 * token is invalidated (410). Attendees become participants — which the
 * pipeline links as person entities, powering time-triggered briefings.
 */
export function createCalendarConnector(opts: CalendarConnectorOptions): Connector {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxEvents ?? 50;
  const daysPast = opts.daysPast ?? 7;
  const daysFuture = opts.daysFuture ?? 30;
  const authHeader = { Authorization: `Bearer ${opts.accessToken}` };

  async function api<T>(
    qs: URLSearchParams,
  ): Promise<{ ok: boolean; status: number; body: T; error?: string }> {
    const res = await fetchWithRetry(`${CAL_API}?${qs.toString()}`, { headers: authHeader }, { fetchImpl: doFetch });
    if (!res.ok) {
      const error = await res.text().catch(() => "");
      return { ok: false, status: res.status, body: undefined as T, error };
    }
    return { ok: true, status: res.status, body: (await res.json()) as T };
  }

  /**
   * Surface a hard API failure instead of silently ingesting nothing. A 403
   * usually means the Calendar API isn't enabled for the OAuth client's project;
   * 401 means the token was rejected.
   */
  function failHard(status: number, error: string | undefined): never {
    throw new Error(
      `Calendar API error (${status}): ${error?.slice(0, 500) ?? "request failed"}`,
    );
  }

  function windowParams(): URLSearchParams {
    const now = opts.now ?? new Date();
    const timeMin = new Date(now.getTime() - daysPast * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + daysFuture * 86_400_000).toISOString();
    return new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(Math.min(max, 250)),
      timeMin,
      timeMax,
    });
  }

  type EventsResponse = {
    items?: CalEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
  };

  async function listPaged(initial: URLSearchParams): Promise<{ events: CalEvent[]; syncToken?: string } | "expired"> {
    const events: CalEvent[] = [];
    let pageToken: string | undefined;
    let syncToken: string | undefined;
    do {
      const qs = new URLSearchParams(initial);
      if (pageToken) qs.set("pageToken", pageToken);
      const { ok, status, body, error } = await api<EventsResponse>(qs);
      if (status === 410) return "expired";
      if (!ok) failHard(status, error);
      for (const ev of body.items ?? []) {
        if (ev.status !== "cancelled") events.push(ev);
      }
      pageToken = body.nextPageToken;
      if (body.nextSyncToken) syncToken = body.nextSyncToken;
    } while (pageToken && events.length < max);
    return { events: events.slice(0, max), syncToken };
  }

  return {
    name: "gcal",
    async pull(options?: PullOptions): Promise<PullResult> {
      let result = options?.cursor
        ? await listPaged(new URLSearchParams({ syncToken: options.cursor }))
        : await listPaged(windowParams());

      if (result === "expired") {
        result = await listPaged(windowParams()); // sync token invalid -> full resync
        if (result === "expired") result = { events: [], syncToken: undefined };
      }

      return {
        items: result.events.map(toRawItem),
        cursor: result.syncToken ?? options?.cursor ?? null,
      };
    },
  };
}
