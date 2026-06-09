import type { Connector, PullResult, RawItem } from "./connector.js";
import { fetchWithRetry } from "../util/http.js";

const GRAPH_CONTACTS = "https://graph.microsoft.com/v1.0/me/contacts";
const SELECT =
  "id,displayName,emailAddresses,mobilePhone,homePhones,businessPhones,companyName,jobTitle,lastModifiedDateTime";

export interface OutlookContactsConnectorOptions {
  accessToken: string;
  maxContacts?: number;
  fetchImpl?: typeof fetch;
}

interface GraphContact {
  id: string;
  displayName?: string;
  emailAddresses?: { address?: string; name?: string }[];
  mobilePhone?: string | null;
  homePhones?: string[];
  businessPhones?: string[];
  companyName?: string;
  jobTitle?: string;
  lastModifiedDateTime?: string;
}

function firstPhone(c: GraphContact): string | undefined {
  return c.mobilePhone ?? c.businessPhones?.[0] ?? c.homePhones?.[0] ?? undefined;
}

function updatedAt(c: GraphContact): Date {
  // Stable timestamp so re-ingest dedups on (source, externalId, occurred_at).
  const t = c.lastModifiedDateTime;
  return t && !Number.isNaN(Date.parse(t)) ? new Date(t) : new Date(0);
}

function toRawItem(c: GraphContact): RawItem | null {
  const name = c.displayName?.trim();
  const email = c.emailAddresses?.[0]?.address?.trim().toLowerCase();
  const phone = firstPhone(c)?.trim();
  if (!name && !email && !phone) return null;

  const bodyLines = [
    name && `Name: ${name}`,
    email && `Email: ${email}`,
    phone && `Phone: ${phone}`,
    c.companyName && `Org: ${c.companyName}${c.jobTitle ? ` (${c.jobTitle})` : ""}`,
  ].filter(Boolean);

  return {
    externalId: c.id,
    occurredAt: updatedAt(c),
    kind: "contact",
    title: `Contact: ${name ?? email ?? phone}`,
    body: bodyLines.join("\n"),
    raw: Buffer.from(JSON.stringify(c)),
    contentType: "application/json",
    participants: [
      {
        name,
        email,
        phone,
        role: "other",
        attrs: {
          ...(c.companyName ? { org: c.companyName } : {}),
          ...(c.jobTitle ? { title: c.jobTitle } : {}),
        },
      },
    ],
    meta: { resourceId: c.id },
  };
}

/**
 * Outlook contacts connector (Microsoft Graph /me/contacts). Seeds the People
 * graph: each contact becomes a stable-dated `contact` episode whose single
 * participant resolves to a person entity keyed by email/phone.
 */
export function createOutlookContactsConnector(opts: OutlookContactsConnectorOptions): Connector {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxContacts ?? 200;
  const authHeader = { Authorization: `Bearer ${opts.accessToken}` };

  return {
    name: "mscontacts",
    async pull(): Promise<PullResult> {
      const contacts: GraphContact[] = [];
      const qs = new URLSearchParams({ $select: SELECT, $top: String(Math.min(max, 100)) });
      let url: string | undefined = `${GRAPH_CONTACTS}?${qs.toString()}`;
      do {
        const res = await fetchWithRetry(url, { headers: authHeader }, { fetchImpl: doFetch });
        if (!res.ok) {
          // Surface hard failures (401 bad token, 403 missing Contacts.Read
          // consent) instead of silently ingesting nothing.
          const error = await res.text().catch(() => "");
          throw new Error(
            `Microsoft Graph (contacts) error (${res.status}): ${error.slice(0, 500)}`,
          );
        }
        const body = (await res.json()) as {
          value?: GraphContact[];
          "@odata.nextLink"?: string;
        };
        for (const c of body.value ?? []) contacts.push(c);
        url = body["@odata.nextLink"];
      } while (url && contacts.length < max);

      const items = contacts
        .slice(0, max)
        .map(toRawItem)
        .filter((i): i is RawItem => i !== null);
      return { items };
    },
  };
}
