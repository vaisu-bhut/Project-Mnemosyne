export type AnswerSegment =
  | { type: "text"; value: string }
  | { type: "cite"; episodeId: string };

/**
 * Split a grounded answer into text and inline `[episode:<id>]` citation
 * segments. Pure, so it can be unit-tested independently of rendering.
 */
export function parseCitations(text: string): AnswerSegment[] {
  const re = /\[episode:([^\]]+)\]/g;
  const out: AnswerSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({ type: "cite", episodeId: m[1]!.trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}
