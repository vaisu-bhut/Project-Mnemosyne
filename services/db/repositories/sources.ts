import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { SourcesTable } from "../types.js";

export type Source = Selectable<SourcesTable>;

export interface CreateSourceInput {
  userId: string;
  kind: string;
  displayName: string;
  scope?: string;
  sensitive?: boolean;
  config?: Record<string, unknown>;
}

/** Create a connector/source row owned by a user. */
export async function createSource(
  db: Db,
  input: CreateSourceInput,
): Promise<Source> {
  return db
    .insertInto("sources")
    .values({
      user_id: input.userId,
      kind: input.kind,
      display_name: input.displayName,
      scope: input.scope,
      sensitive: input.sensitive,
      config: input.config,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Fetch a source scoped to its owner (returns undefined if not owned). */
export async function getSource(
  db: Db,
  userId: string,
  sourceId: string,
): Promise<Source | undefined> {
  return db
    .selectFrom("sources")
    .selectAll()
    .where("id", "=", sourceId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}
