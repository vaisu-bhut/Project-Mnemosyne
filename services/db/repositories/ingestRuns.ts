import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { IngestRunItemRow, IngestRunStatus, IngestRunsTable } from "../types.js";

export type IngestRun = Selectable<IngestRunsTable>;

/** A compact sample of a recently-ingested item, surfaced live in the UI. */
export type IngestRunItem = IngestRunItemRow;

/** Open a new ingest run (status 'queued') for a source. */
export async function createIngestRun(
  db: Db,
  userId: string,
  sourceId: string,
): Promise<IngestRun> {
  return db
    .insertInto("ingest_runs")
    .values({ user_id: userId, source_id: sourceId, status: "queued" })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface UpdateIngestRunInput {
  status?: IngestRunStatus;
  ingested?: number;
  total?: number | null;
  items?: IngestRunItem[];
  error?: string | null;
  finishedAt?: Date | null;
}

/** Patch an ingest run (counts, status, item sample, terminal fields). */
export async function updateIngestRun(
  db: Db,
  id: string,
  patch: UpdateIngestRunInput,
): Promise<void> {
  await db
    .updateTable("ingest_runs")
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.ingested !== undefined ? { ingested: patch.ingested } : {}),
      ...(patch.total !== undefined ? { total: patch.total } : {}),
      ...(patch.items !== undefined ? { items: JSON.stringify(patch.items) } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.finishedAt !== undefined ? { finished_at: patch.finishedAt } : {}),
    })
    .where("id", "=", id)
    .execute();
}

/** The most recent ingest run for a source, scoped to its owner. */
export async function getLatestIngestRun(
  db: Db,
  userId: string,
  sourceId: string,
): Promise<IngestRun | undefined> {
  return db
    .selectFrom("ingest_runs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("source_id", "=", sourceId)
    .orderBy("started_at", "desc")
    .limit(1)
    .executeTakeFirst();
}
