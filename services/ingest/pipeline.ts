import {
  createOpenLoop,
  getFirstOauthAccount,
  getOauthAccountById,
  insertEdge,
  updateSourceConfig,
  type Db,
  type Source,
} from "../db/index.js";
import type { AppConfig } from "../config/index.js";
import { encryptText } from "../auth/crypto.js";
import type { Embedder } from "../embeddings/index.js";
import type { Extractor, EntityType } from "../extract/index.js";
import { recordEntity, recordEpisode, recordFact } from "../memory/encode.js";
import type { ArtifactStore } from "../storage/index.js";
import { sleep } from "../util/http.js";
import type { Connector, Participant } from "./connector.js";

export interface IngestDeps {
  db: Db;
  store: ArtifactStore;
  embedder: Embedder;
  /** When set, encrypt the sensitive tier (sensitive sources) at rest. */
  encKey?: string;
}

export interface IngestSummary {
  ingested: number;
  episodeIds: string[];
}

/** Live progress reported as the pipeline records each episode. */
export interface IngestProgress {
  /** Episodes recorded so far. */
  ingested: number;
  /** Total items pulled this run (known before the loop). */
  total: number;
  /** The item just recorded (for a live "what's being ingested" feed). */
  lastItem: { title: string | null; kind: string };
}

export interface RunIngestOptions {
  /** Called after each episode is recorded; await is honored (DB write OK). */
  onProgress?: (p: IngestProgress) => void | Promise<void>;
  /** Pause between items to stay under embedding/provider rate limits (ms). */
  itemDelayMs?: number;
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
    const key = (p.email ?? p.phone ?? name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Email + phone are strong identity aliases (so the same person always
    // resolves to one entity across emails, events, and contacts).
    const aliases = [p.email, p.phone].filter((a): a is string => Boolean(a));
    const attrs = {
      ...(p.email ? { email: p.email } : {}),
      ...(p.phone ? { phone: p.phone } : {}),
      ...(p.attrs ?? {}),
    };

    const entity = await recordEntity(
      { db: deps.db, embedder: deps.embedder },
      {
        userId,
        type: "person",
        canonicalName: p.name?.trim() || p.email || p.phone!,
        aliases,
        attrs,
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
  opts: RunIngestOptions = {},
): Promise<IngestSummary> {
  await deps.store.init();

  // Resume from the per-source cursor (incremental sync), if any.
  const priorConfig = source.config as Record<string, unknown>;
  const cursor = typeof priorConfig.cursor === "string" ? priorConfig.cursor : null;
  const { items, cursor: nextCursor } = await connector.pull({ cursor });

  // Sensitive-tier encryption: encrypt raw payloads + episode bodies at rest.
  const encrypt = source.sensitive && deps.encKey ? deps.encKey : null;

  const episodeIds: string[] = [];
  for (const item of items) {
    const key = artifactKey(source, item.externalId);
    const rawToStore = encrypt
      ? Buffer.from(encryptText(item.raw.toString("base64"), encrypt))
      : item.raw;
    await deps.store.putArtifact(key, rawToStore, item.contentType);

    // Persist attachments to the object store; reference them on the episode.
    const attachmentKeys: { key: string; filename: string; contentType: string }[] = [];
    for (const att of item.attachments ?? []) {
      const attKey = `${key}/att/${att.filename}`;
      const attData = encrypt
        ? Buffer.from(encryptText(att.data.toString("base64"), encrypt))
        : att.data;
      await deps.store.putArtifact(attKey, attData, att.contentType);
      attachmentKeys.push({ key: attKey, filename: att.filename, contentType: att.contentType });
    }

    const meta = {
      ...(item.meta ?? {}),
      ...(attachmentKeys.length ? { attachments: attachmentKeys } : {}),
      ...(encrypt ? { encrypted: true } : {}),
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
        // Embed from plaintext; store ciphertext when the source is sensitive.
        body: encrypt ? encryptText(item.body, encrypt) : item.body,
        embedText: encrypt ? item.body : undefined,
        artifactUri: key,
        meta,
      },
    );
    episodeIds.push(episode.id);

    if (item.participants?.length) {
      await linkParticipants(deps, source.user_id, episode.id, item.participants);
    }

    await opts.onProgress?.({
      ingested: episodeIds.length,
      total: items.length,
      lastItem: { title: item.title ?? null, kind: item.kind },
    });

    // Pace the run so a burst of embeddings/API calls stays under rate limits.
    if (opts.itemDelayMs && episodeIds.length < items.length) {
      await sleep(opts.itemDelayMs);
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

  if (source.kind === "gmail" || source.kind === "gcal" || source.kind === "gcontacts") {
    // Resolve the connected account this source is bound to (falling back to
    // the user's first Google account for legacy/unbound sources), then get a
    // valid token for it (refreshed if needed).
    const account = source.oauth_account_id
      ? ((await getOauthAccountById(deps.db, source.user_id, source.oauth_account_id)) ??
        (await getFirstOauthAccount(deps.db, source.user_id, "google")))
      : await getFirstOauthAccount(deps.db, source.user_id, "google");
    if (!account) {
      throw new Error("Google account not connected for this source");
    }
    const { getValidGoogleAccessTokenForAccount } = await import("../auth/google.js");
    const accessToken = await getValidGoogleAccessTokenForAccount(
      deps.db,
      deps.config,
      account,
    );
    if (source.kind === "gmail") {
      const { createGmailConnector } = await import("./gmail.js");
      return createGmailConnector({
        accessToken,
        query: deps.config.GMAIL_QUERY,
        maxMessages: deps.config.GMAIL_MAX_MESSAGES,
      });
    }
    if (source.kind === "gcontacts") {
      const { createContactsConnector } = await import("./gcontacts.js");
      return createContactsConnector({
        accessToken,
        maxContacts: deps.config.CONTACTS_MAX_RESULTS,
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

  if (source.kind === "msmail" || source.kind === "mscal" || source.kind === "mscontacts") {
    // Resolve the connected Microsoft account this source is bound to (falling
    // back to the user's first Microsoft account for unbound sources).
    const account = source.oauth_account_id
      ? ((await getOauthAccountById(deps.db, source.user_id, source.oauth_account_id)) ??
        (await getFirstOauthAccount(deps.db, source.user_id, "microsoft")))
      : await getFirstOauthAccount(deps.db, source.user_id, "microsoft");
    if (!account) {
      throw new Error("Microsoft account not connected for this source");
    }
    const { getValidMicrosoftAccessTokenForAccount } = await import("../auth/microsoft.js");
    const accessToken = await getValidMicrosoftAccessTokenForAccount(
      deps.db,
      deps.config,
      account,
    );
    if (source.kind === "msmail") {
      const { createOutlookMailConnector } = await import("./outlookMail.js");
      return createOutlookMailConnector({
        accessToken,
        maxMessages: deps.config.OUTLOOK_MAX_MESSAGES,
      });
    }
    if (source.kind === "mscontacts") {
      const { createOutlookContactsConnector } = await import("./outlookContacts.js");
      return createOutlookContactsConnector({
        accessToken,
        maxContacts: deps.config.CONTACTS_MAX_RESULTS,
      });
    }
    const { createOutlookCalendarConnector } = await import("./outlookCalendar.js");
    return createOutlookCalendarConnector({
      accessToken,
      daysPast: deps.config.CALENDAR_DAYS_PAST,
      daysFuture: deps.config.CALENDAR_DAYS_FUTURE,
      maxEvents: deps.config.CALENDAR_MAX_EVENTS,
    });
  }

  throw new Error(`No connector for source kind "${source.kind}"`);
}
