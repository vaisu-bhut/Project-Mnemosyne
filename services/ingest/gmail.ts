import type { Connector, PullResult, RawItem } from "./connector.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailConnectorOptions {
  accessToken: string;
  /** Gmail search query, e.g. "newer_than:30d". */
  query?: string;
  maxMessages?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[]; mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
}

function header(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Walk the MIME tree and concatenate text/plain parts. */
function extractPlainText(payload: GmailMessage["payload"]): string {
  if (!payload) return "";
  const out: string[] = [];
  const walk = (part: GmailPart): void => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      out.push(decodeBase64Url(part.body.data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  if (payload.body?.data && payload.mimeType === "text/plain") {
    out.push(decodeBase64Url(payload.body.data));
  }
  for (const part of payload.parts ?? []) walk(part);
  return out.join("\n").trim();
}

/**
 * Gmail connector: reads messages via the Gmail REST API using a (already
 * valid) access token and maps each to an episode RawItem. Token acquisition /
 * refresh happens upstream in connectorForSource.
 */
export function createGmailConnector(opts: GmailConnectorOptions): Connector {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxMessages ?? 25;
  const query = opts.query ?? "newer_than:30d";
  const authHeader = { Authorization: `Bearer ${opts.accessToken}` };

  return {
    name: "gmail",
    async pull(): Promise<PullResult> {
      const listUrl = `${GMAIL_API}/messages?maxResults=${max}&q=${encodeURIComponent(query)}`;
      const listRes = await doFetch(listUrl, { headers: authHeader });
      if (!listRes.ok) {
        throw new Error(`Gmail list failed (${listRes.status}): ${await listRes.text()}`);
      }
      const list = (await listRes.json()) as { messages?: { id: string }[] };
      const items: RawItem[] = [];

      for (const { id } of list.messages ?? []) {
        const msgRes = await doFetch(`${GMAIL_API}/messages/${id}?format=full`, {
          headers: authHeader,
        });
        if (!msgRes.ok) continue;
        const msg = (await msgRes.json()) as GmailMessage;

        const subject = header(msg, "Subject") ?? "(no subject)";
        const from = header(msg, "From") ?? "";
        const occurredAt = msg.internalDate
          ? new Date(Number(msg.internalDate))
          : new Date();
        const body = extractPlainText(msg.payload) || msg.snippet || "";

        items.push({
          externalId: msg.id,
          occurredAt,
          kind: "email",
          title: subject,
          body: from ? `From: ${from}\n\n${body}` : body,
          raw: Buffer.from(JSON.stringify(msg)),
          contentType: "application/json",
          meta: { from, threadId: msg.threadId ?? null, snippet: msg.snippet ?? null },
        });
      }

      return { items };
    },
  };
}
