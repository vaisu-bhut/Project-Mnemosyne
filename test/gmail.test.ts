import { describe, expect, it } from "vitest";
import { createGmailConnector } from "../services/ingest/gmail.js";

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
}
function notFound(): Response {
  return { ok: false, status: 404, json: async () => ({}), text: async () => "expired" } as unknown as Response;
}
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function message(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    threadId: `t-${id}`,
    snippet: "snippet",
    internalDate: "1700000000000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "Subject", value: `Subject ${id}` },
        { name: "From", value: "Sara Lin <sara@example.com>" },
        { name: "To", value: "me@example.com" },
      ],
      parts: [{ mimeType: "text/plain", body: { data: b64url("Let's grab lunch.") } }],
    },
    ...extra,
  };
}

describe("Gmail connector — backfill (no cursor)", () => {
  it("lists, maps participants + body, and returns the history cursor", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/profile")) return ok({ historyId: "100" });
      if (url.includes("/messages?")) return ok({ messages: [{ id: "m1" }] });
      if (url.includes("/messages/m1")) return ok(message("m1"));
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const c = createGmailConnector({ accessToken: "t", maxMessages: 5, fetchAttachments: false, fetchImpl });
    const { items, cursor } = await c.pull();

    expect(cursor).toBe("100");
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("m1");
    expect(items[0]!.title).toBe("Subject m1");
    expect(items[0]!.body).toContain("From: Sara Lin <sara@example.com>");
    expect(items[0]!.body).toContain("Let's grab lunch.");
    expect(items[0]!.participants).toContainEqual({ name: "Sara Lin", email: "sara@example.com", role: "from" });
  });
});

describe("Gmail connector — incremental (with cursor)", () => {
  it("pulls only messages added since the cursor and advances it", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/history?")) {
        return ok({ history: [{ messagesAdded: [{ message: { id: "m2" } }] }], historyId: "150" });
      }
      if (url.includes("/messages/m2")) return ok(message("m2"));
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const c = createGmailConnector({ accessToken: "t", fetchAttachments: false, fetchImpl });
    const { items, cursor } = await c.pull({ cursor: "100" });

    expect(cursor).toBe("150");
    expect(items.map((i) => i.externalId)).toEqual(["m2"]);
  });

  it("falls back to backfill when the cursor has expired (404)", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/history?")) return notFound();
      if (url.includes("/profile")) return ok({ historyId: "200" });
      if (url.includes("/messages?")) return ok({ messages: [{ id: "m9" }] });
      if (url.includes("/messages/m9")) return ok(message("m9"));
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const c = createGmailConnector({ accessToken: "t", fetchAttachments: false, fetchImpl });
    const { items, cursor } = await c.pull({ cursor: "1" });

    expect(cursor).toBe("200");
    expect(items.map((i) => i.externalId)).toEqual(["m9"]);
  });
});

describe("Gmail connector — attachments", () => {
  it("fetches attachment bytes when present", async () => {
    const msg = message("m1", {
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "Subject", value: "with file" }, { name: "From", value: "a@x.com" }],
        parts: [
          { mimeType: "text/plain", body: { data: b64url("see attached") } },
          { filename: "report.pdf", mimeType: "application/pdf", body: { attachmentId: "att1" } },
        ],
      },
    });
    const fetchImpl = (async (url: string) => {
      if (url.includes("/profile")) return ok({ historyId: "1" });
      if (url.includes("/messages?")) return ok({ messages: [{ id: "m1" }] });
      if (url.includes("/attachments/att1")) return ok({ data: b64url("%PDF-1.4 fake") });
      if (url.includes("/messages/m1")) return ok(msg);
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const c = createGmailConnector({ accessToken: "t", fetchImpl });
    const { items } = await c.pull();
    expect(items[0]!.attachments).toHaveLength(1);
    expect(items[0]!.attachments![0]!.filename).toBe("report.pdf");
    expect(items[0]!.attachments![0]!.data.toString("utf8")).toContain("%PDF");
  });
});
