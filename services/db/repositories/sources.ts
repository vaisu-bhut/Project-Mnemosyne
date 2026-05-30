import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { SourcesTable } from "../types.js";

export type Source = Selectable<SourcesTable>;

export interface CreateSourceInput {
  kind: string;
  displayName: string;
  scope?: string;
  sensitive?: boolean;
  config?: Record<string, unknown>;
}

/** Create a connector/source row. */
export async function createSource(
  db: Db,
  input: CreateSourceInput,
): Promise<Source> {
  return db
    .insertInto("sources")
    .values({
      kind: input.kind,
      display_name: input.displayName,
      scope: input.scope,
      sensitive: input.sensitive,
      config: input.config,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
