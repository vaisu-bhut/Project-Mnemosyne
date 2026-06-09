import type { Connector, Participant, PullResult, RawItem } from "./connector.js";

const GRAPH_CALENDAR_VIEW = "https://graph.microsoft.com/v1.0/me/calendarView";

export interface OutlookCalendarConnectorOptions {
  accessToken: string;
  daysPast?: number;
  daysFuture?: number;
  maxEvents?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  now?: Date;
}

interface GraphAttendee {
  emailAddress?: { name?: string; address?: string };
  type?: string; // "required" | "optional" | "resource"
}
interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isCancelled?: boolean;
  location?: { displayName?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  organizer?: GraphAttendee;
  attendees?: GraphAttendee[];
}

function startDate(ev: GraphEvent): Date {
  // calendarView returns UTC when Prefer: outlook.timezone="UTC" is sent.
  const s = ev.start?.dateTime;
  const d = s ? new Date(s.endsWith("Z") ? s : `${s}Z`) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function participantsOf(ev: GraphEvent): Participant[] {
  const out: Participant[] = [];
  const org = ev.organizer?.emailAddress;
  if (org?.address) {
    out.push({ email: org.address.toLowerCase(), name: org.name, role: "from" });
  }
  for (const a of ev.attendees ?? []) {
    const addr = a.emailAddress?.address?.toLowerCase();
    if (!addr || addr === org?.address?.toLowerCase()) continue;
    out.push({ email: addr, name: a.emailAddress?.name, role: "to" });
  }
  return out;
}

function toRawItem(ev: GraphEvent): RawItem {
  const location = ev.location?.displayName;
  const body = [location && `Location: ${location}`, ev.bodyPreview].filter(Boolean).join("\n\n");
  return {
    externalId: ev.id,
    occurredAt: startDate(ev),
    kind: "calendar_event",
    title: ev.subject || "(untitled event)",
    body,
    raw: Buffer.from(JSON.stringify(ev)),
    contentType: "application/json",
    participants: participantsOf(ev),
    meta: {
      start: ev.start?.dateTime ?? null,
      end: ev.end?.dateTime ?? null,
      location: location ?? null,
    },
  };
}

/**
 * Outlook calendar connector (Microsoft Graph /me/calendarView). Lists events in
 * a [now-daysPast, now+daysFuture] window; attendees + organizer become
 * participants (linked as person entities, powering pre-meeting briefings).
 */
export function createOutlookCalendarConnector(opts: OutlookCalendarConnectorOptions): Connector {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxEvents ?? 50;
  const daysPast = opts.daysPast ?? 7;
  const daysFuture = opts.daysFuture ?? 30;
  const authHeader = {
    Authorization: `Bearer ${opts.accessToken}`,
    Prefer: 'outlook.timezone="UTC"',
  };

  return {
    name: "mscal",
    async pull(): Promise<PullResult> {
      const now = opts.now ?? new Date();
      const startDateTime = new Date(now.getTime() - daysPast * 86_400_000).toISOString();
      const endDateTime = new Date(now.getTime() + daysFuture * 86_400_000).toISOString();
      const qs = new URLSearchParams({
        startDateTime,
        endDateTime,
        $select: "id,subject,bodyPreview,isCancelled,location,start,end,organizer,attendees",
        $orderby: "start/dateTime",
        $top: String(Math.min(max, 100)),
      });

      const events: GraphEvent[] = [];
      let url: string | undefined = `${GRAPH_CALENDAR_VIEW}?${qs.toString()}`;
      do {
        const res = await doFetch(url, { headers: authHeader });
        if (!res.ok) {
          // Surface hard failures (401 bad token, 403 missing Calendars.Read
          // consent) instead of silently ingesting nothing.
          const error = await res.text().catch(() => "");
          throw new Error(
            `Microsoft Graph (calendar) error (${res.status}): ${error.slice(0, 500)}`,
          );
        }
        const body = (await res.json()) as {
          value?: GraphEvent[];
          "@odata.nextLink"?: string;
        };
        for (const ev of body.value ?? []) {
          if (!ev.isCancelled) events.push(ev);
        }
        url = body["@odata.nextLink"];
      } while (url && events.length < max);

      return { items: events.slice(0, max).map(toRawItem) };
    },
  };
}
