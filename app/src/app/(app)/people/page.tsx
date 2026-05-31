"use client";

import { Users } from "lucide-react";
import { usePeopleHealth } from "@/hooks/usePeople";
import { ApiError } from "@/lib/api/client";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FullPageSpinner } from "@/components/common/Spinner";
import { PersonCard } from "@/components/people/PersonCard";

export default function PeoplePage() {
  const people = usePeopleHealth();

  return (
    <>
      <PageHeader
        title="People"
        description="Relationship health across the people in your memory."
      />

      {people.isLoading ? (
        <FullPageSpinner />
      ) : people.isError ? (
        <ErrorState
          message={people.error instanceof ApiError ? people.error.message : "Failed to load people"}
          onRetry={() => void people.refetch()}
        />
      ) : people.data && people.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.data.map((person) => (
            <PersonCard key={person.entityId} person={person} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No people yet"
          description="Ingest notes, email, or contacts and people will appear here as they're mentioned."
        />
      )}
    </>
  );
}
