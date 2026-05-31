"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { useUpcomingBriefings } from "@/hooks/useBriefings";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { BriefingView } from "@/components/people/BriefingView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const HOURS = [
  { value: 24, label: "Next 24h" },
  { value: 72, label: "Next 3 days" },
  { value: 168, label: "Next week" },
];

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function BriefingsPage() {
  const [hours, setHours] = useState(24);
  const briefings = useUpcomingBriefings(hours);

  return (
    <>
      <PageHeader
        title="Briefings"
        description="Auto-assembled pre-meeting briefings for upcoming calendar events."
        action={
          <select
            className={selectClass}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            {HOURS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        }
      />

      {briefings.isLoading ? (
        <FullPageSpinner />
      ) : briefings.isError ? (
        <ErrorState
          message={
            briefings.error instanceof ApiError
              ? briefings.error.message
              : "Failed to load briefings"
          }
          onRetry={() => void briefings.refetch()}
        />
      ) : briefings.data && briefings.data.length > 0 ? (
        <div className="space-y-6">
          {briefings.data.map((b) => (
            <Card key={`${b.eventId}-${b.briefing.entityId}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="size-4" />
                  {b.eventTitle ?? "Upcoming event"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {new Date(b.eventStart).toLocaleString()}
                </p>
              </CardHeader>
              <CardContent>
                <BriefingView briefing={b.briefing} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title="No upcoming briefings"
          description="Connect Google Calendar and ingest events with attendees to get pre-meeting briefings."
        />
      )}
    </>
  );
}
