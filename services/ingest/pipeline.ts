import {
  createOpenLoop,
  insertEdge,
  type Db,
  type Source,
} from "../db/index.js";
import type { Embedder } from "../embeddings/index.js";
import type { Extractor, EntityType } from "../extract/index.js";
import { recordEntity, recordEpisode, recordFact } from "../memory/encode.js";
import type { ArtifactStore } from "../storage/index.js";
import type { Connector } from "./connector.js";

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
  const { items } = await connector.pull();
  const episodeIds: string[] = [];

  for (const item of items) {
    const key = artifactKey(source, item.externalId);
    await deps.store.putArtifact(key, item.raw, item.contentType);

    const episode = await recordEpisode(
      { db: deps.db, embedder: deps.embedder },
      {
        occurredAt: item.occurredAt,
        sourceId: source.id,
        externalId: item.externalId,
        kind: item.kind,
        title: item.title ?? null,
        body: item.body,
        artifactUri: key,
        meta: item.meta,
      },
    );
    episodeIds.push(episode.id);
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
    .select(["id", "source_id", "title", "body"])
    .where("id", "=", episodeId)
    .executeTakeFirstOrThrow();

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
      { type: typeOf.get(name) ?? "person", canonicalName: name },
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

/** Build the connector for a source from its stored config. */
export async function connectorForSource(source: Source): Promise<Connector> {
  if (source.kind === "filesystem") {
    const dir = (source.config as { dir?: unknown }).dir;
    if (typeof dir !== "string") {
      throw new Error(`source ${source.id} (filesystem) is missing config.dir`);
    }
    const { createFilesystemConnector } = await import("./filesystem.js");
    return createFilesystemConnector({ dir });
  }
  throw new Error(`No connector for source kind "${source.kind}"`);
}
