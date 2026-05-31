"use client";

import type { Answer } from "@/lib/api/types";
import { AnswerText } from "@/components/AnswerText";
import { Citation } from "@/components/Citation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AnswerView({ answer }: { answer: Answer }) {
  // De-dupe citations by episode id for the "sources" footer.
  const sourceIds = Array.from(
    new Set(answer.citations.map((c) => c.episodeId).filter((id): id is string => Boolean(id))),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Answer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm">
            <AnswerText text={answer.answer} />
          </div>
        </CardContent>
      </Card>

      {sourceIds.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Sources ({sourceIds.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {sourceIds.map((id) => (
              <Citation key={id} episodeId={id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
