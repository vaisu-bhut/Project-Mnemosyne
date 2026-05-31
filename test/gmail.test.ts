import { describe, expect, it } from "vitest";
import { createGmailConnector } from "../services/ingest/gmail.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("Gmail connector", () => {
  it("maps Gmail messages to episode RawItems", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes("/messages?")) {
        return jsonResponse({ messages: [{ id: "m1" }] });
      }
      return jsonResponse({
        id: "m1",
        threadId: "t1",
        snippet: "snippet text",
        internalDate: "1700000000000",
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "Subject", value: "Lunch plans" },
            { name: "From", value: "sara@example.com" },
          ],
          parts: [{ mimeType: "text/plain", body: { data: b64url("Let's grab lunch Thursday.") } }],
        },
      });
    }) as unknown as typeof fetch;

    const connector = createGmailConnector({ accessToken: "tok", maxMessages: 5, fetchImpl });
    const { items } = await connector.pull();

    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.externalId).toBe("m1");
    expect(item.kind).toBe("email");
    expect(item.title).toBe("Lunch plans");
    expect(item.body).toContain("From: sara@example.com");
    expect(item.body).toContain("Let's grab lunch Thursday.");
    expect(item.occurredAt.getTime()).toBe(1_700_000_000_000);
    expect(item.meta?.threadId).toBe("t1");
  });

  it("falls back to the snippet when there's no text/plain part", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/messages?")) return jsonResponse({ messages: [{ id: "m2" }] });
      return jsonResponse({
        id: "m2",
        snippet: "just a snippet",
        internalDate: "1700000000000",
        payload: { headers: [{ name: "Subject", value: "No body" }] },
      });
    }) as unknown as typeof fetch;

    const connector = createGmailConnector({ accessToken: "tok", fetchImpl });
    const { items } = await connector.pull();
    expect(items[0]!.body).toContain("just a snippet");
  });
});
