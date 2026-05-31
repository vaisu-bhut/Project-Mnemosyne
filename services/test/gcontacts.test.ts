import { describe, expect, it } from "vitest";
import { createContactsConnector } from "../ingest/gcontacts.js";

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
}

describe("Contacts connector", () => {
  it("maps connections to contact items with email + phone participants", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain("personFields=");
      return ok({
        connections: [
          {
            resourceName: "people/c1",
            names: [{ displayName: "Sara Lin" }],
            emailAddresses: [{ value: "Sara@X.com" }],
            phoneNumbers: [{ value: "+1-555-0100" }],
            organizations: [{ name: "Acme", title: "PM" }],
            metadata: { sources: [{ updateTime: "2026-05-01T00:00:00.000Z" }] },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const c = createContactsConnector({ accessToken: "t", fetchImpl });
    const { items } = await c.pull();

    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.kind).toBe("contact");
    expect(item.externalId).toBe("people/c1");
    expect(item.occurredAt.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(item.participants).toEqual([
      {
        name: "Sara Lin",
        email: "sara@x.com",
        phone: "+1-555-0100",
        role: "other",
        attrs: { org: "Acme", title: "PM" },
      },
    ]);
  });
});
