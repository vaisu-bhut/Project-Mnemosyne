import { sql } from "kysely";
import type { Db, RetentionTier } from "../db/index.js";
import type { ArtifactStore } from "../storage/index.js";

export interface RetentionDeps {
  db: Db;
  store: ArtifactStore;
}

export interface SetRetentionInput {
  tier?: RetentionTier;
  /** Postgres interval string, e.g. "90 days". Overrides the global default. */
  compressAfter?: string | null;
  purgeAfter?: string | null;
  vaulted?: boolean;
}

/** Upsert a per-episode retention policy. */
export async function setRetention(
  db: Db,
  episodeId: string,
  input: SetRetentionInput,
): Promise<void> {
  await db
    .insertInto("retention")
    .values({
      episode_id: episodeId,
      tier: input.tier,
      compress_after: input.compressAfter ?? null,
      purge_after: input.purgeAfter ?? null,
      vaulted: input.vaulted,
    })
    .onConflict((oc) =>
      oc.column("episode_id").doUpdateSet({
        tier: input.tier,
        compress_after: input.compressAfter ?? null,
        purge_after: input.purgeAfter ?? null,
        vaulted: input.vaulted,
      }),
    )
    .execute();
}

export interface ForgetResult {
  episode: number;
  facts: number;
  edges: number;
  openLoops: number;
  artifactDeleted: boolean;
}

/**
 * The real "forget": purge an episode across every store — its facts, the edges
 * referencing it, open loops sourced from it, its retention row, the episode
 * itself, and the raw artifact in object storage.
 */
export async function forgetEpisode(
  deps: RetentionDeps,
  episodeId: string,
): Promise<ForgetResult> {
  const { db, store } = deps;

  const episode = await db
    .selectFrom("episodes")
    .select(["id", "artifact_uri"])
    .where("id", "=", episodeId)
    .executeTakeFirst();
  if (!episode) {
    return { episode: 0, facts: 0, edges: 0, openLoops: 0, artifactDeleted: false };
  }

  const counts = await db.transaction().execute(async (trx) => {
    const f = await trx.deleteFrom("facts").where("source_episode", "=", episodeId).executeTakeFirst();
    const e = await trx
      .deleteFrom("edges")
      .where((eb) => eb.or([eb("src_id", "=", episodeId), eb("dst_id", "=", episodeId)]))
      .executeTakeFirst();
    const l = await trx.deleteFrom("open_loops").where("source_episode", "=", episodeId).executeTakeFirst();
    await trx.deleteFrom("retention").where("episode_id", "=", episodeId).execute();
    await trx.deleteFrom("episodes").where("id", "=", episodeId).execute();
    return {
      facts: Number(f.numDeletedRows ?? 0n),
      edges: Number(e.numDeletedRows ?? 0n),
      openLoops: Number(l.numDeletedRows ?? 0n),
    };
  });

  let artifactDeleted = false;
  if (episode.artifact_uri) {
    await store.deleteArtifact(episode.artifact_uri);
    artifactDeleted = true;
  }

  return { episode: 1, ...counts, artifactDeleted };
}

export interface EnforceRetentionOptions {
  compressAfterDays?: number;
  purgeAfterDays?: number;
  now?: Date;
}

export interface EnforceRetentionResult {
  compressed: number;
  purged: number;
}

/**
 * Apply the tiered forgetting policy:
 *   - purge (full forget) episodes past their purge horizon,
 *   - compress (drop the raw body, keep embedding + artifact) episodes past
 *     their compress horizon.
 * `raw_forever` and `vaulted` episodes are never touched. Per-episode interval
 * overrides win over the global day defaults.
 */
export async function enforceRetention(
  deps: RetentionDeps,
  opts: EnforceRetentionOptions = {},
): Promise<EnforceRetentionResult> {
  const { db } = deps;
  const compressDays = opts.compressAfterDays ?? 90;
  const purgeDays = opts.purgeAfterDays ?? 365;
  const now = opts.now ?? new Date();

  // Purge first (these would otherwise also match compression).
  const toPurge = await sql<{ id: string }>`
    SELECT e.id
    FROM episodes e
    LEFT JOIN retention r ON r.episode_id = e.id
    WHERE COALESCE(r.tier, 'standard') <> 'raw_forever'
      AND NOT COALESCE(r.vaulted, false)
      AND e.occurred_at < ${now}::timestamptz
        - COALESCE(r.purge_after, (${purgeDays} || ' days')::interval)
  `.execute(db);

  for (const { id } of toPurge.rows) await forgetEpisode(deps, id);

  const compressed = await sql<{ id: string }>`
    WITH c AS (
      SELECT e.id,
             COALESCE(r.tier, 'standard') AS tier,
             COALESCE(r.vaulted, false) AS vaulted,
             COALESCE(r.compress_after, (${compressDays} || ' days')::interval) AS compress_after,
             e.occurred_at
      FROM episodes e
      LEFT JOIN retention r ON r.episode_id = e.id
    )
    UPDATE episodes e
    SET body = NULL, meta = e.meta || '{"compressed":true}'::jsonb
    FROM c
    WHERE e.id = c.id
      AND e.body IS NOT NULL
      AND c.tier <> 'raw_forever'
      AND NOT c.vaulted
      AND c.occurred_at < ${now}::timestamptz - c.compress_after
    RETURNING e.id
  `.execute(db);

  return { purged: toPurge.rows.length, compressed: compressed.rows.length };
}
