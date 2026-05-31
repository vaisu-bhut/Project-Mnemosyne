"use client";

import { Fragment, type ReactNode } from "react";
import { Citation } from "@/components/Citation";

/** Render a grounded answer, turning inline [episode:<id>] markers into
 * click-through citations. */
export function AnswerText({ text }: { text: string }) {
  const re = /\[episode:([^\]]+)\]/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<Fragment key={`t${i}`}>{text.slice(last, m.index)}</Fragment>);
    }
    parts.push(<Citation key={`c${i}`} episodeId={m[1]!.trim()} className="mx-0.5" />);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) parts.push(<Fragment key="tail">{text.slice(last)}</Fragment>);

  return <p className="whitespace-pre-wrap leading-relaxed">{parts}</p>;
}
