import { randomUUID } from "node:crypto";
import { createSource, listSources, type Db } from "../db/index.js";
import type { ArtifactStore } from "../storage/index.js";
import type { Embedder } from "../embeddings/index.js";
import { recordEpisode } from "../memory/encode.js";
import { runExtraction, type ExtractSummary } from "../ingest/pipeline.js";
import type { Extractor } from "../extract/index.js";

/**
 * Voice-note capture. The user records an utterance; we store the audio (proof),
 * transcribe it, and on confirmation create a `voice_note` episode and extract
 * its people + relationships into the graph. This is the one place the user
 * deliberately adds to memory.
 */

const VOICE_SOURCE_KIND = "voice";

/** The per-user "Voice notes" source, created on first use. */
export async function findOrCreateVoiceSource(db: Db, userId: string): Promise<string> {
  const sources = await listSources(db, userId);
  const existing = sources.find((s) => s.kind === VOICE_SOURCE_KIND);
  if (existing) return existing.id;
  const created = await createSource(db, {
    userId,
    kind: VOICE_SOURCE_KIND,
    displayName: "Voice notes",
    scope: "personal",
  });
  return created.id;
}

/** Store an uploaded audio clip; returns the artifact key (S3-swappable). */
export async function storeAudio(
  store: ArtifactStore,
  userId: string,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "audio";
  const key = `voice/${userId}/${randomUUID()}.${ext}`;
  await store.putArtifact(key, audio, mimeType);
  return key;
}

export interface CommitVoiceDeps {
  db: Db;
  embedder: Embedder;
  extractor: Extractor;
}

export interface CommittedVoiceNote {
  episodeId: string;
  extraction: ExtractSummary;
}

/**
 * Persist a confirmed voice note: create the episode (linked to the stored
 * audio) and run extraction so its people, relationships, facts, and open loops
 * land in the graph immediately.
 */
export async function commitVoiceNote(
  deps: CommitVoiceDeps,
  userId: string,
  input: { transcript: string; artifactKey?: string | null; title?: string | null; occurredAt?: Date },
): Promise<CommittedVoiceNote> {
  const sourceId = await findOrCreateVoiceSource(deps.db, userId);
  const transcript = input.transcript.trim();
  const title = input.title?.trim() || transcript.slice(0, 60) || "Voice note";

  const episode = await recordEpisode(
    { db: deps.db, embedder: deps.embedder },
    {
      userId,
      occurredAt: input.occurredAt ?? new Date(),
      sourceId,
      externalId: input.artifactKey ?? randomUUID(),
      kind: "voice_note",
      title,
      body: transcript,
      artifactUri: input.artifactKey ?? null,
    },
  );

  const extraction = await runExtraction(
    { db: deps.db, embedder: deps.embedder, extractor: deps.extractor },
    episode.id,
  );

  return { episodeId: episode.id, extraction };
}
