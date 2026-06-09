import type { Connector, Participant, PullResult, RawItem } from "./connector.js";
import { htmlToText, stripQuoted } from "./emailText.js";

const GRAPH_MESSAGES = "https://graph.microsoft.com/v1.0/me/messages";
const SELECT =
  "id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,conversationId";

export interface OutlookMailConnectorOptions {
  accessToken: string;
  maxMessages?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}
interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  conversationId?: string;
}

function asParticipant(r: GraphRecipient | undefined, role: Participant["role"]): Participant | null {
  const addr = r?.emailAddress?.address?.trim().toLowerCase();
  const name = r?.emailAddress?.name?.trim();
  if (!addr && !name) return null;
  return { email: addr, name: name || undefined, role };
}

function participantsOf(msg: GraphMessage): Participant[] {
  const out: Participant[] = [];
  const from = asParticipant(msg.from, "from");
  if (from) out.push(from);
  for (const r of msg.toRecipients ?? []) {
    const p = asParticipant(r, "to");
    if (p) out.push(p);
  }
  for (const r of msg.ccRecipients ?? []) {
    const p = asParticipant(r, "cc");
    if (p) out.push(p);
  }
  return out;
}

function addrLine(r: GraphRecipient | undefined): string | undefined {
  const a = r?.emailAddress;
  if (!a?.address && !a?.name) return undefined;
  return a?.name && a?.address ? `${a.name} <${a.address}>` : (a?.address ?? a?.name);
}

function bodyText(msg: GraphMessage): string {
  const raw =
    msg.body?.contentType?.toLowerCase() === "html"
      ? htmlToText(msg.body.content ?? "")
      : (msg.body?.content ?? msg.bodyPreview ?? "");
  return stripQuoted(raw);
}

function toRawItem(msg: GraphMessage): RawItem {
  const from = addrLine(msg.from);
  const to = (msg.toRecipients ?? []).map(addrLine).filter(Boolean).join(", ");
  const cc = (msg.ccRecipients ?? []).map(addrLine).filter(Boolean).join(", ");
  const headerLines = [from && `From: ${from}`, to && `To: ${to}`, cc && `Cc: ${cc}`]
    .filter(Boolean)
    .join("\n");
  const body = `${headerLines}\n\n${bodyText(msg)}`.trim();

  return {
    externalId: msg.id,
    occurredAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    kind: "email",
    title: msg.subject || "(no subject)",
    body,
    raw: Buffer.from(JSON.stringify(msg)),
    contentType: "application/json",
    participants: participantsOf(msg),
    meta: { from, conversationId: msg.conversationId ?? null, snippet: msg.bodyPreview ?? null },
  };
}

/**
 * Outlook mail connector (Microsoft Graph /me/messages). Pulls the most recent
 * `maxMessages` messages, newest first. (Incremental delta sync is a later
 * enhancement; for now each run fetches the latest window — episode dedup on
 * (source, externalId, occurred_at) makes re-ingest idempotent.)
 */
export function createOutlookMailConnector(opts: OutlookMailConnectorOptions): Connector {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxMessages ?? 25;
  const authHeader = { Authorization: `Bearer ${opts.accessToken}` };

  return {
    name: "msmail",
    async pull(): Promise<PullResult> {
      const messages: GraphMessage[] = [];
      const qs = new URLSearchParams({
        $select: SELECT,
        $top: String(Math.min(max, 100)),
        $orderby: "receivedDateTime desc",
      });
      let url: string | undefined = `${GRAPH_MESSAGES}?${qs.toString()}`;
      do {
        const res = await doFetch(url, { headers: authHeader });
        if (!res.ok) {
          // Surface hard failures (401 bad token, 403 missing Mail.Read consent)
          // instead of silently ingesting nothing.
          const error = await res.text().catch(() => "");
          throw new Error(`Microsoft Graph (mail) error (${res.status}): ${error.slice(0, 500)}`);
        }
        const body = (await res.json()) as {
          value?: GraphMessage[];
          "@odata.nextLink"?: string;
        };
        for (const m of body.value ?? []) messages.push(m);
        url = body["@odata.nextLink"];
      } while (url && messages.length < max);

      return { items: messages.slice(0, max).map(toRawItem) };
    },
  };
}
