/**
 * Map raw OAuth scope strings to the human-facing "services" a connected
 * account has granted, so the UI can show e.g. "Gmail, Calendar" and the user
 * can tell what's missing and grant more.
 */
export interface ServiceInfo {
  key: "gmail" | "mail" | "calendar" | "contacts" | "identity";
  label: string;
}

// Scope strings are distinct across providers, so one map covers both. Microsoft
// Graph scopes are case-insensitive and may arrive with a resource prefix
// (e.g. "https://graph.microsoft.com/Mail.Read") — normalized below.
const SCOPE_SERVICE: Record<string, ServiceInfo> = {
  // Google
  "https://www.googleapis.com/auth/gmail.readonly": { key: "gmail", label: "Gmail" },
  "https://www.googleapis.com/auth/calendar.readonly": { key: "calendar", label: "Calendar" },
  "https://www.googleapis.com/auth/contacts.readonly": { key: "contacts", label: "Contacts" },
  // Microsoft Graph
  "mail.read": { key: "mail", label: "Outlook Mail" },
  "calendars.read": { key: "calendar", label: "Calendar" },
  "contacts.read": { key: "contacts", label: "Contacts" },
  // Identity (both providers)
  openid: { key: "identity", label: "Sign-in" },
  email: { key: "identity", label: "Sign-in" },
  profile: { key: "identity", label: "Sign-in" },
};

const ORDER: ServiceInfo["key"][] = ["gmail", "mail", "calendar", "contacts", "identity"];

/** Normalize a raw scope token: strip a Graph resource prefix, lowercase MS scopes. */
function normalizeScope(raw: string): string {
  if (raw.startsWith("https://www.googleapis.com/")) return raw; // Google: exact match
  const bare = raw.replace(/^https:\/\/graph\.microsoft\.com\//i, "");
  return bare.toLowerCase();
}

/**
 * Parse a space-separated scope string into a deduped, stably-ordered list of
 * granted services. Unknown scopes are ignored.
 */
export function servicesFromScope(scope: string | null | undefined): ServiceInfo[] {
  if (!scope) return [];
  const byKey = new Map<ServiceInfo["key"], ServiceInfo>();
  for (const raw of scope.split(/\s+/).filter(Boolean)) {
    const svc = SCOPE_SERVICE[normalizeScope(raw)];
    if (svc) byKey.set(svc.key, svc);
  }
  return ORDER.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
}
