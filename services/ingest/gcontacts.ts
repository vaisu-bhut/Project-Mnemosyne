import type { Connector, PullResult, RawItem } from "./connector.js";
import { fetchWithRetry } from "../util/http.js";

const PEOPLE_API = "https://people.googleapis.com/v1/people/me/connections";
const FIELDS =
  "names,emailAddresses,phoneNumbers,organizations,birthdays,metadata";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A People API birthday as a human-readable string ("March 4" or "March 4, 1990"),
 * preferring the structured date and falling back to free text. */
function formatBirthday(b: { date?: { year?: number; month?: number; day?: number }; text?: string }): string | null {
  const d = b.date;
  if (d?.month && d.day) {
    const md = `${MONTHS[d.month - 1]} ${d.day}`;
    return d.year ? `${md}, ${d.year}` : md;
  }
  return b.text?.trim() || null;
}

export interface ContactsConnectorOptions {
  accessToken: string;
  maxContacts?: number;
  fetchImpl?: typeof fetch;
}

interface Person {
  resourceName: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
  birthdays?: { date?: { year?: number; month?: number; day?: number }; text?: string }[];
  metadata?: { sources?: { updateTime?: string }[] };
}

function updatedAt(p: Person): Date {
  const t = p.metadata?.sources?.find((s) => s.updateTime)?.updateTime;
  // Stable timestamp so re-ingest dedups on (source, externalId, occurred_at).
  return t && !Number.isNaN(Date.parse(t)) ? new Date(t) : new Date(0);
}

function toRawItem(p: Person): RawItem | null {
  const name = p.names?.[0]?.displayName?.trim();
  const email = p.emailAddresses?.[0]?.value?.trim().toLowerCase();
  const phone = p.phoneNumbers?.[0]?.value?.trim();
  if (!name && !email && !phone) return null;

  const org = p.organizations?.[0];
  const birthday = p.birthdays?.map(formatBirthday).find(Boolean) ?? null;
  const bodyLines = [
    name && `Name: ${name}`,
    email && `Email: ${email}`,
    phone && `Phone: ${phone}`,
    org?.name && `Org: ${org.name}${org.title ? ` (${org.title})` : ""}`,
    birthday && `Birthday: ${birthday}`,
  ].filter(Boolean);

  return {
    externalId: p.resourceName,
    occurredAt: updatedAt(p),
    kind: "contact",
    title: `Contact: ${name ?? email ?? phone}`,
    body: bodyLines.join("\n"),
    raw: Buffer.from(JSON.stringify(p)),
    contentType: "application/json",
    participants: [
      {
        name,
        email,
        phone,
        role: "other",
        attrs: {
          ...(org?.name ? { org: org.name } : {}),
          ...(org?.title ? { title: org.title } : {}),
          ...(birthday ? { birthday } : {}),
        },
      },
    ],
    meta: { resourceName: p.resourceName },
  };
}

/**
 * Google Contacts connector (People API). Seeds the People graph's identity
 * layer: each contact becomes a stable-dated `contact` episode whose single
 * participant resolves to a person entity keyed by email/phone — so future
 * emails, events, and notes from the same address attach to the right person.
 */
export function createContactsConnector(opts: ContactsConnectorOptions): Connector {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxContacts ?? 200;
  const authHeader = { Authorization: `Bearer ${opts.accessToken}` };

  return {
    name: "gcontacts",
    async pull(): Promise<PullResult> {
      const people: Person[] = [];
      let pageToken: string | undefined;
      do {
        const qs = new URLSearchParams({
          personFields: FIELDS,
          pageSize: String(Math.min(max, 100)),
        });
        if (pageToken) qs.set("pageToken", pageToken);
        const res = await fetchWithRetry(`${PEOPLE_API}?${qs.toString()}`, { headers: authHeader }, { fetchImpl: doFetch });
        if (!res.ok) {
          // Surface hard failures (e.g. 403 People API disabled, 401 bad token)
          // instead of silently ingesting nothing.
          const error = await res.text().catch(() => "");
          throw new Error(`People API error (${res.status}): ${error.slice(0, 500)}`);
        }
        const body = (await res.json()) as { connections?: Person[]; nextPageToken?: string };
        for (const c of body.connections ?? []) people.push(c);
        pageToken = body.nextPageToken;
      } while (pageToken && people.length < max);

      const items = people
        .slice(0, max)
        .map(toRawItem)
        .filter((i): i is RawItem => i !== null);
      return { items };
    },
  };
}
