import { sql, type Selectable } from "kysely";
import type { Db } from "../client.js";
import type { SourcesTable } from "../types.js";

export type Source = Selectable<SourcesTable>;

/** Per-app permission definitions. Only `read` is enforced today (ingestion);
 * `write`/`delete` are declarations for the future write/action layer. */
export type SourcePermissions = {
  read: boolean;
  write: boolean;
  delete: boolean;
  mode: "autonomous" | "approval";
};

export interface CreateSourceInput {
  userId: string;
  kind: string;
  displayName: string;
  scope?: string;
  sensitive?: boolean;
  config?: Record<string, unknown>;
  /** For OAuth-backed kinds: the connected account this source pulls from. */
  oauthAccountId?: string | null;
  permissions?: SourcePermissions;
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
      oauth_account_id: input.oauthAccountId ?? null,
      permissions: input.permissions,
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

/** Replace a source's config jsonb (e.g. to persist an incremental cursor). */
export async function updateSourceConfig(
  db: Db,
  sourceId: string,
  config: Record<string, unknown>,
): Promise<void> {
  await db
    .updateTable("sources")
    .set({ config })
    .where("id", "=", sourceId)
    .execute();
}

/**
 * Clear the `needsReauth` flag from a source's config (e.g. after a successful
 * ingest). Uses the jsonb `-` operator so it doesn't clobber a cursor written
 * concurrently by the ingest run.
 */
export async function clearSourceReauth(db: Db, sourceId: string): Promise<void> {
  await db
    .updateTable("sources")
    .set({ config: sql`config - 'needsReauth'` })
    .where("id", "=", sourceId)
    .execute();
}

/** List a user's sources (newest first). */
export async function listSources(db: Db, userId: string): Promise<Source[]> {
  return db
    .selectFrom("sources")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .execute();
}

/** Set a source's privacy classification (Guardian inputs). Owner-scoped. */
export async function classifySource(
  db: Db,
  userId: string,
  sourceId: string,
  patch: { sensitive?: boolean; scope?: string; permissions?: SourcePermissions },
): Promise<Source | undefined> {
  return db
    .updateTable("sources")
    .set({
      ...(patch.sensitive !== undefined ? { sensitive: patch.sensitive } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
    })
    .where("id", "=", sourceId)
    .where("user_id", "=", userId)
    .returningAll()
    .executeTakeFirst();
}
