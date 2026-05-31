"use client";

import { Fragment } from "react";
import { Citation } from "@/components/Citation";
import { parseCitations } from "@/lib/citations";

/** Render a grounded answer, turning inline [episode:<id>] markers into
 * click-through citations. */
export function AnswerText({ text }: { text: string }) {
  const segments = parseCitations(text);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <Fragment key={i}>{seg.value}</Fragment>
        ) : (
          <Citation key={i} episodeId={seg.episodeId} className="mx-0.5" />
        ),
      )}
    </p>
  );
}
