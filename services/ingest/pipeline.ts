import {
  createOpenLoop,
  insertEdge,
  updateSourceConfig,
  type Db,
  type Source,
} from "../db/index.js";
import type { AppConfig } from "../config/index.js";
import type { Embedder } from "../embeddings/index.js";
import type { Extractor, EntityType } from "../extract/index.js";
import { recordEntity, recordEpisode, recordFact } from "../memory/encode.js";
import type { ArtifactStore } from "../storage/index.js";
import type { Connector, Participant } from "./connector.js";

export interface IngestDeps {
  db: Db;
  store: ArtifactStore;
  embedder: Embedder;
}

export interface IngestSummary {
  ingested: number;
  episodeIds: string[];
}

/** Sanitize an external id into an artifact key segment. */
function artifactKey(source: Source, externalId: string): string {
  const safe = externalId.replace(/\.\.+/g, ".").replace(/^\/+/, "");
  return `${source.kind}/${source.id}/${safe}`;
}

/** A display label for a participant: name if present, else the email. */
function participantName(p: Participant): string | null {
  return p.name?.trim() || p.email || null;
}

/**
 * Create/resolve a person entity for each participant (email used as a strong
 * identity alias so the same address always resolves to one entity) and link
 * them to the episode. Deterministic — complements LLM extraction from the body.
 */
async function linkParticipants(
  deps: IngestDeps,
  userId: string,
  episodeId: string,
  participants: Participant[],
): Promise<void> {
  const seen = new Set<string>();
  for (const p of participants) {
    const name = participantName(p);
    if (!name) continue;
    const key = (p.email ?? name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const entity = await recordEntity(
      { db: deps.db, embedder: deps.embedder },
      {
        userId,
        type: "person",
        canonicalName: p.name?.trim() || p.email!,
        aliases: p.email ? [p.email] : [],
        attrs: p.email ? { email: p.email } : {},
      },
    );
    await insertEdge(deps.db, {
      userId,
      srcId: entity.id,
      dstId: episodeId,
      rel: "mentioned_in",
      props: { role: p.role },
    });
  }
}

/**
 * Pull items from a connector and store each as an episode: raw payload to the
 * artifact store, the episode (embedded) to Postgres. Idempotent on
 * (source_id, external_id, occurred_at), so re-ingesting is safe.
 *
 * NOTE: extraction is enqueued separately (see the worker). Re-ingesting an
 * already-seen item returns the existing episode; re-extraction would duplicate
 * facts until Phase 2 consolidation dedupes — acceptable for now.
 */
export async function runIngest(
  deps: IngestDeps,
  source: Source,
  connector: Connector,
): Promise<IngestSummary> {
  await deps.store.init();

  // Resume from the per-source cursor (incremental sync), if any.
  const priorConfig = source.config as Record<string, unknown>;
  const cursor = typeof priorConfig.cursor === "string" ? priorConfig.cursor : null;
  const { items, cursor: nextCursor } = await connector.pull({ cursor });

  const episodeIds: string[] = [];
  for (const item of items) {
    const key = artifactKey(source, item.externalId);
    await deps.store.putArtifact(key, item.raw, item.contentType);

    // Persist attachments to the object store; reference them on the episode.
    const attachmentKeys: { key: string; filename: string; contentType: string }[] = [];
    for (const att of item.attachments ?? []) {
      const attKey = `${key}/att/${att.filename}`;
      await deps.store.putArtifact(attKey, att.data, att.contentType);
      attachmentKeys.push({ key: attKey, filename: att.filename, contentType: att.contentType });
    }

    const meta = {
      ...(item.meta ?? {}),
      ...(attachmentKeys.length ? { attachments: attachmentKeys } : {}),
    };

    const episode = await recordEpisode(
      { db: deps.db, embedder: deps.embedder },
      {
        userId: source.user_id,
        occurredAt: item.occurredAt,
        sourceId: source.id,
        externalId: item.externalId,
        kind: item.kind,
        title: item.title ?? null,
        body: item.body,
        artifactUri: key,
        meta,
      },
    );
    episodeIds.push(episode.id);

    if (item.participants?.length) {
      await linkParticipants(deps, source.user_id, episode.id, item.participants);
    }
  }

  // Persist the advanced cursor for the next incremental run.
  if (nextCursor != null && nextCursor !== cursor) {
    await updateSourceConfig(deps.db, source.id, { ...priorConfig, cursor: nextCursor });
  }

  return { ingested: items.length, episodeIds };
}

export interface ExtractDeps {
  db: Db;
  embedder: Embedder;
  extractor: Extractor;
}

export interface ExtractSummary {
  episodeId: string;
  entities: number;
  facts: number;
  openLoops: number;
}

/**
 * Extract entities/facts/open-loops from one episode and write them with
 * mandatory provenance (source_episode + source_id), embeddings, and
 * `mentioned_in` edges linking each entity to the episode.
 */
export async function runExtraction(
  deps: ExtractDeps,
  episodeId: string,
): Promise<ExtractSummary> {
  const episode = await deps.db
    .selectFrom("episodes")
    .select(["id", "user_id", "source_id", "title", "body"])
    .where("id", "=", episodeId)
    .executeTakeFirstOrThrow();

  const userId = episode.user_id;

  const result = await deps.extractor.extract({
    title: episode.title,
    body: episode.body ?? "",
  });

  const typeOf = new Map<string, EntityType>(
    result.entities.map((e) => [e.name, e.type]),
  );
  const idByName = new Map<string, string>();

  const ensureEntity = async (name: string): Promise<string> => {
    const existing = idByName.get(name);
    if (existing) return existing;
    const entity = await recordEntity(
      { db: deps.db, embedder: deps.embedder },
      { userId, type: typeOf.get(name) ?? "person", canonicalName: name },
    );
    idByName.set(name, entity.id);
    return entity.id;
  };

  for (const e of result.entities) await ensureEntity(e.name);

  let factCount = 0;
  for (const f of result.facts) {
    const subjectId = await ensureEntity(f.subject);
    const objectId = f.object ? await ensureEntity(f.object) : null;
    await recordFact(
      { db: deps.db, embedder: deps.embedder },
      {
        userId,
        subjectId,
        statement: f.statement,
        predicate: f.predicate ?? null,
        objectId,
        confidence: f.confidence,
        sourceEpisode: episode.id,
        sourceId: episode.source_id,
      },
    );
    factCount++;
  }

  // Link every mentioned entity to this episode.
  for (const entityId of new Set(idByName.values())) {
    await insertEdge(deps.db, {
      userId,
      srcId: entityId,
      dstId: episode.id,
      rel: "mentioned_in",
    });
  }

  for (const loop of result.openLoops) {
    const counterparty = loop.counterparty
      ? await ensureEntity(loop.counterparty)
      : null;
    await createOpenLoop(deps.db, {
      userId,
      description: loop.description,
      direction: loop.direction,
      counterparty,
      sourceEpisode: episode.id,
    });
  }

  return {
    episodeId: episode.id,
    entities: idByName.size,
    facts: factCount,
    openLoops: result.openLoops.length,
  };
}

export interface ConnectorDeps {
  db: Db;
  config: AppConfig;
}

/** Build the connector for a source from its kind + stored config. */
export async function connectorForSource(
  source: Source,
  deps: ConnectorDeps,
): Promise<Connector> {
  if (source.kind === "filesystem") {
    const dir = (source.config as { dir?: unknown }).dir;
    if (typeof dir !== "string") {
      throw new Error(`source ${source.id} (filesystem) is missing config.dir`);
    }
    const { createFilesystemConnector } = await import("./filesystem.js");
    return createFilesystemConnector({ dir });
  }

  if (source.kind === "gmail" || source.kind === "gcal") {
    // Use the owner's Google tokens (refreshed if needed).
    const { getValidGoogleAccessToken } = await import("../auth/google.js");
    const accessToken = await getValidGoogleAccessToken(
      deps.db,
      deps.config,
      source.user_id,
    );
    if (source.kind === "gmail") {
      const { createGmailConnector } = await import("./gmail.js");
      return createGmailConnector({
        accessToken,
        query: deps.config.GMAIL_QUERY,
        maxMessages: deps.config.GMAIL_MAX_MESSAGES,
      });
    }
    const { createCalendarConnector } = await import("./gcal.js");
    return createCalendarConnector({
      accessToken,
      daysPast: deps.config.CALENDAR_DAYS_PAST,
      daysFuture: deps.config.CALENDAR_DAYS_FUTURE,
      maxEvents: deps.config.CALENDAR_MAX_EVENTS,
    });
  }

  throw new Error(`No connector for source kind "${source.kind}"`);
}
