import type {
  Attachment,
  Connector,
  PullOptions,
  PullResult,
  RawItem,
} from "./connector.js";
import { htmlToText, participantsFromHeaders, stripQuoted } from "./emailText.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailConnectorOptions {
  accessToken: string;
  /** Gmail search query for the initial backfill, e.g. "newer_than:30d". */
  query?: string;
  /** Cap on messages fetched per run (backfill paginates up to this). */
  maxMessages?: number;
  /** Fetch + return attachment bytes (default true). */
  fetchAttachments?: boolean;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { data?: string; attachmentId?: string };
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
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeB64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Collect best-effort body text (prefer text/plain, fall back to HTML). */
function extractBody(payload: GmailMessage["payload"]): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailPart): void => {
    if (part.body?.data) {
      if (part.mimeType === "text/plain") plain.push(decodeB64Url(part.body.data));
      else if (part.mimeType === "text/html") html.push(decodeB64Url(part.body.data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  if (payload.body?.data && payload.mimeType === "text/plain") plain.push(decodeB64Url(payload.body.data));
  for (const part of payload.parts ?? []) walk(part);

  const raw = plain.length ? plain.join("\n") : html.length ? htmlToText(html.join("\n")) : "";
  return stripQuoted(raw);
}

function attachmentParts(payload: GmailMessage["payload"]): GmailPart[] {
  const out: GmailPart[] = [];
  const walk = (part: GmailPart): void => {
    if (part.filename && part.body?.attachmentId) out.push(part);
    for (const child of part.parts ?? []) walk(child);
  };
  for (const part of payload?.parts ?? []) walk(part);
  return out;
}

/**
 * Production Gmail connector. First run (no cursor) backfills via messages.list
 * for the configured query and records the current historyId as the cursor.
 * Later runs sync incrementally via the History API from that cursor; if the
 * cursor is too old (404), it transparently falls back to a backfill.
 */
export function createGmailConnector(opts: GmailConnectorOptions): Connector {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxMessages ?? 25;
  const query = opts.query ?? "newer_than:30d";
  const fetchAttachments = opts.fetchAttachments ?? true;
  const authHeader = { Authorization: `Bearer ${opts.accessToken}` };

  async function api<T>(path: string): Promise<{ ok: boolean; status: number; body: T }> {
    const res = await doFetch(`${GMAIL_API}${path}`, { headers: authHeader });
    const body = res.ok ? ((await res.json()) as T) : (undefined as T);
    return { ok: res.ok, status: res.status, body };
  }

  async function currentHistoryId(): Promise<string | undefined> {
    const { ok, body } = await api<{ historyId?: string }>("/profile");
    return ok ? body.historyId : undefined;
  }

  /** Backfill: collect up to `max` message ids matching the query (paginated). */
  async function backfillIds(): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ q: query, maxResults: String(Math.min(max, 100)) });
      if (pageToken) qs.set("pageToken", pageToken);
      const { ok, body } = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(
        `/messages?${qs.toString()}`,
      );
      if (!ok) break;
      for (const m of body.messages ?? []) ids.push(m.id);
      pageToken = body.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  /** Incremental: message ids added since `startHistoryId`, plus new cursor. */
  async function incrementalIds(
    startHistoryId: string,
  ): Promise<{ ids: string[]; cursor?: string } | "expired"> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    let latest: string | undefined;
    do {
      const qs = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" });
      if (pageToken) qs.set("pageToken", pageToken);
      const { ok, status, body } = await api<{
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        historyId?: string;
        nextPageToken?: string;
      }>(`/history?${qs.toString()}`);
      if (status === 404) return "expired";
      if (!ok) break;
      for (const h of body.history ?? []) {
        for (const added of h.messagesAdded ?? []) ids.push(added.message.id);
      }
      if (body.historyId) latest = body.historyId;
      pageToken = body.nextPageToken;
    } while (pageToken && ids.length < max);
    return { ids: ids.slice(0, max), cursor: latest ?? startHistoryId };
  }

  async function fetchAttachmentData(messageId: string, part: GmailPart): Promise<Attachment | null> {
    const { ok, body } = await api<{ data?: string }>(
      `/messages/${messageId}/attachments/${part.body!.attachmentId}`,
    );
    if (!ok || !body.data) return null;
    return {
      filename: part.filename!,
      contentType: part.mimeType ?? "application/octet-stream",
      data: Buffer.from(body.data, "base64url"),
    };
  }

  async function toRawItem(id: string): Promise<RawItem | null> {
    const { ok, body: msg } = await api<GmailMessage>(`/messages/${id}?format=full`);
    if (!ok || !msg?.id) return null;

    const from = header(msg, "From");
    const to = header(msg, "To");
    const cc = header(msg, "Cc");
    const subject = header(msg, "Subject") ?? "(no subject)";
    const occurredAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
    const participants = participantsFromHeaders({ from, to, cc });

    const cleaned = extractBody(msg.payload) || msg.snippet || "";
    const headerLines = [from && `From: ${from}`, to && `To: ${to}`, cc && `Cc: ${cc}`]
      .filter(Boolean)
      .join("\n");
    const body = `${headerLines}\n\n${cleaned}`.trim();

    let attachments: Attachment[] | undefined;
    if (fetchAttachments) {
      const parts = attachmentParts(msg.payload);
      const fetched = await Promise.all(parts.map((p) => fetchAttachmentData(msg.id, p)));
      attachments = fetched.filter((a): a is Attachment => a !== null);
      if (attachments.length === 0) attachments = undefined;
    }

    return {
      externalId: msg.id,
      occurredAt,
      kind: "email",
      title: subject,
      body,
      raw: Buffer.from(JSON.stringify(msg)),
      contentType: "application/json",
      participants,
      attachments,
      meta: { from, threadId: msg.threadId ?? null, snippet: msg.snippet ?? null },
    };
  }

  return {
    name: "gmail",
    async pull(options?: PullOptions): Promise<PullResult> {
      let ids: string[];
      let cursor: string | undefined;

      if (options?.cursor) {
        const inc = await incrementalIds(options.cursor);
        if (inc === "expired") {
          ids = await backfillIds();
          cursor = await currentHistoryId();
        } else {
          ids = inc.ids;
          cursor = inc.cursor;
        }
      } else {
        // First run: capture the history baseline *before* backfill so we don't
        // miss messages that arrive during it.
        cursor = await currentHistoryId();
        ids = await backfillIds();
      }

      const items: RawItem[] = [];
      for (const id of ids) {
        const item = await toRawItem(id);
        if (item) items.push(item);
      }
      return { items, cursor: cursor ?? null };
    },
  };
}
