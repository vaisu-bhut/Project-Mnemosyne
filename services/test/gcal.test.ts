import { describe, expect, it } from "vitest";
import { createCalendarConnector } from "../ingest/gcal.js";

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
}
function gone(): Response {
  return { ok: false, status: 410, json: async () => ({}), text: async () => "sync token invalid" } as unknown as Response;
}

function event(id: string) {
  return {
    id,
    status: "confirmed",
    summary: `1:1 ${id}`,
    description: "sync up",
    location: "Room 4",
    start: { dateTime: "2026-06-01T10:00:00.000Z" },
    end: { dateTime: "2026-06-01T10:30:00.000Z" },
    organizer: { email: "me@x.com", self: true },
    attendees: [
      { email: "me@x.com", self: true },
      { email: "sara@x.com", displayName: "Sara Lin" },
    ],
  };
}

describe("Calendar connector", () => {
  it("backfills a window, maps attendees (excluding self), returns a syncToken", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain("timeMin=");
      return ok({ items: [event("ev1")], nextSyncToken: "sync-1" });
    }) as unknown as typeof fetch;

    const c = createCalendarConnector({ accessToken: "t", fetchImpl });
    const { items, cursor } = await c.pull();

    expect(cursor).toBe("sync-1");
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("calendar_event");
    expect(items[0]!.title).toBe("1:1 ev1");
    expect(items[0]!.occurredAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(items[0]!.participants).toEqual([{ email: "sara@x.com", name: "Sara Lin", role: "to" }]);
  });

  it("syncs incrementally from a syncToken", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain("syncToken=sync-1");
      return ok({ items: [event("ev2")], nextSyncToken: "sync-2" });
    }) as unknown as typeof fetch;

    const c = createCalendarConnector({ accessToken: "t", fetchImpl });
    const { items, cursor } = await c.pull({ cursor: "sync-1" });
    expect(cursor).toBe("sync-2");
    expect(items.map((i) => i.externalId)).toEqual(["ev2"]);
  });

  it("resyncs the window when the syncToken is invalid (410)", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("syncToken=old")) return gone();
      return ok({ items: [event("ev1")], nextSyncToken: "sync-3" });
    }) as unknown as typeof fetch;

    const c = createCalendarConnector({ accessToken: "t", fetchImpl });
    const { items, cursor } = await c.pull({ cursor: "old" });
    expect(cursor).toBe("sync-3");
    expect(items).toHaveLength(1);
  });
});
