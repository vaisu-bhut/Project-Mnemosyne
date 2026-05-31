import type { Participant } from "./connector.js";

interface Address {
  name?: string;
  email?: string;
}

/** Parse an RFC-ish address-list header ("Name <e@x>, e2@y") into addresses. */
export function parseAddressList(header: string | undefined): Address[] {
  if (!header) return [];
  return header
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((part) => {
      const angled = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(part);
      if (angled) {
        const name = angled[1]!.trim();
        return { name: name || undefined, email: angled[2]!.trim().toLowerCase() };
      }
      if (part.includes("@")) return { email: part.replace(/[<>]/g, "").toLowerCase() };
      return { name: part };
    })
    .filter((a) => a.name || a.email);
}

/** Build typed participants from From/To/Cc headers. */
export function participantsFromHeaders(headers: {
  from?: string;
  to?: string;
  cc?: string;
}): Participant[] {
  const out: Participant[] = [];
  for (const a of parseAddressList(headers.from)) out.push({ ...a, role: "from" });
  for (const a of parseAddressList(headers.to)) out.push({ ...a, role: "to" });
  for (const a of parseAddressList(headers.cc)) out.push({ ...a, role: "cc" });
  return out;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Crude but dependency-free HTML -> text for HTML-only emails. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#\d+;|&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_MARKERS = [
  /\n>?\s*On .+wrote:/i, // Gmail/Apple "On <date>, X wrote:"
  /\n-{3,}\s*Original Message\s*-{3,}/i, // Outlook
  /\n_{5,}/, // Outlook divider
  /\nFrom:.*\nSent:.*/i, // Outlook header block
];

/** Remove quoted reply chains and signatures, keeping the new content. */
export function stripQuoted(text: string): string {
  let cut = text;
  for (const marker of QUOTE_MARKERS) {
    const m = marker.exec(cut);
    if (m) cut = cut.slice(0, m.index);
  }
  // Drop leading-">" quote lines and a trailing "-- " signature block.
  const sig = cut.split(/\n-- \n/)[0] ?? cut;
  return sig
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\nSent from my [^\n]*$/i, "")
    .trim();
}
