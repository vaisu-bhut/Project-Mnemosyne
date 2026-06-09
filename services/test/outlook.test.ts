import { describe, expect, it } from "vitest";
import { createOutlookMailConnector } from "../ingest/outlookMail.js";
import { createOutlookCalendarConnector } from "../ingest/outlookCalendar.js";
import { createOutlookContactsConnector } from "../ingest/outlookContacts.js";

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
}

describe("Outlook mail connector", () => {
  it("maps messages to items with participants, header lines, and dedup id", async () => {
    const message = {
      id: "AAMk-1",
      subject: "Re: Iceland",
      bodyPreview: "preview",
      body: { contentType: "text", content: "Let's book the flights." },
      from: { emailAddress: { name: "Sara Lin", address: "Sara@Example.com" } },
      toRecipients: [{ emailAddress: { name: "Me", address: "me@example.com" } }],
      ccRecipients: [],
      receivedDateTime: "2026-01-02T03:04:05Z",
      conversationId: "c-1",
    };
    const fetchImpl = (async (url: string) => {
      if (url.includes("/me/messages")) return ok({ value: [message] });
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const c = createOutlookMailConnector({ accessToken: "t", maxMessages: 10, fetchImpl });
    const { items } = await c.pull();

    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.externalId).toBe("AAMk-1");
    expect(item.kind).toBe("email");
    expect(item.title).toBe("Re: Iceland");
    expect(item.body).toContain("From: Sara Lin <Sara@Example.com>");
    expect(item.body).toContain("Let's book the flights.");
    expect(item.occurredAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    // Address is lowercased for stable person identity.
    expect(item.participants).toContainEqual({ email: "sara@example.com", name: "Sara Lin", role: "from" });
  });

  it("converts HTML bodies to text", async () => {
    const message = {
      id: "m2",
      subject: "HTML",
      body: { contentType: "html", content: "<p>Hello <b>there</b></p>" },
      from: { emailAddress: { address: "a@b.com" } },
      receivedDateTime: "2026-01-01T00:00:00Z",
    };
    const fetchImpl = (async () => ok({ value: [message] })) as unknown as typeof fetch;
    const c = createOutlookMailConnector({ accessToken: "t", fetchImpl });
    const { items } = await c.pull();
    expect(items[0]!.body).toContain("Hello there");
    expect(items[0]!.body).not.toContain("<p>");
  });
});

describe("Outlook calendar connector", () => {
  it("maps events and links organizer + attendees as participants", async () => {
    const event = {
      id: "ev-1",
      subject: "Coffee",
      bodyPreview: "catch up",
      isCancelled: false,
      location: { displayName: "Blue Bottle" },
      start: { dateTime: "2026-02-01T15:00:00.0000000" },
      end: { dateTime: "2026-02-01T16:00:00.0000000" },
      organizer: { emailAddress: { name: "Sara", address: "sara@example.com" } },
      attendees: [
        { emailAddress: { name: "Me", address: "me@example.com" }, type: "required" },
        { emailAddress: { name: "Sara", address: "sara@example.com" } }, // dup of organizer, skipped
      ],
    };
    const fetchImpl = (async (url: string) => {
      if (url.includes("/me/calendarView")) return ok({ value: [event] });
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const c = createOutlookCalendarConnector({ accessToken: "t", fetchImpl, now: new Date("2026-02-01T00:00:00Z") });
    const { items } = await c.pull();

    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("calendar_event");
    expect(items[0]!.title).toBe("Coffee");
    expect(items[0]!.body).toContain("Location: Blue Bottle");
    const emails = items[0]!.participants!.map((p) => p.email);
    expect(emails).toContain("sara@example.com");
    expect(emails).toContain("me@example.com");
    // organizer appears once (attendee dup skipped)
    expect(emails.filter((e) => e === "sara@example.com")).toHaveLength(1);
  });

  it("skips cancelled events", async () => {
    const fetchImpl = (async () =>
      ok({ value: [{ id: "x", subject: "Gone", isCancelled: true, start: { dateTime: "2026-02-01T10:00:00Z" } }] })) as unknown as typeof fetch;
    const c = createOutlookCalendarConnector({ accessToken: "t", fetchImpl });
    const { items } = await c.pull();
    expect(items).toHaveLength(0);
  });
});

describe("Outlook contacts connector", () => {
  it("maps contacts to person episodes keyed by email/phone", async () => {
    const contact = {
      id: "ct-1",
      displayName: "Sara Lin",
      emailAddresses: [{ address: "Sara@Example.com", name: "Sara Lin" }],
      mobilePhone: "+1 555 0100",
      companyName: "Acme",
      jobTitle: "PM",
      lastModifiedDateTime: "2026-01-01T00:00:00Z",
    };
    const fetchImpl = (async (url: string) => {
      if (url.includes("/me/contacts")) return ok({ value: [contact] });
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const c = createOutlookContactsConnector({ accessToken: "t", fetchImpl });
    const { items } = await c.pull();

    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("contact");
    expect(items[0]!.title).toBe("Contact: Sara Lin");
    expect(items[0]!.participants![0]).toMatchObject({
      name: "Sara Lin",
      email: "sara@example.com",
      role: "other",
      attrs: { org: "Acme", title: "PM" },
    });
  });
});
