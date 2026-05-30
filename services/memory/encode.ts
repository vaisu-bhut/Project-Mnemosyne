import {
  insertEpisode,
  insertFact,
  upsertEntity,
  type Db,
  type Entity,
  type Episode,
  type Fact,
  type InsertEpisodeInput,
  type InsertFactInput,
  type UpsertEntityInput,
} from "../db/index.js";
import type { Embedder } from "../embeddings/index.js";

/**
 * The "encode" layer: embed text, then write through the repositories. Keeps
 * the db package free of any embedding dependency — composition happens here.
 */
export interface EncodeDeps {
  db: Db;
  embedder: Embedder;
}

async function embedOrNull(
  embedder: Embedder,
  text: string | null | undefined,
): Promise<number[] | null> {
  const trimmed = text?.trim();
  return trimmed ? embedder.embedOne(trimmed) : null;
}

/** Insert an episode, embedding title+body (unless `embedText` overrides). */
export async function recordEpisode(
  deps: EncodeDeps,
  input: Omit<InsertEpisodeInput, "embedding"> & { embedText?: string },
): Promise<Episode> {
  const text =
    input.embedText ?? [input.title, input.body].filter(Boolean).join("\n");
  const embedding = await embedOrNull(deps.embedder, text);
  return insertEpisode(deps.db, { ...input, embedding });
}

/** Upsert an entity, embedding its canonical name + aliases. */
export async function recordEntity(
  deps: EncodeDeps,
  input: Omit<UpsertEntityInput, "embedding"> & { embedText?: string },
): Promise<Entity> {
  const text =
    input.embedText ?? [input.canonicalName, ...(input.aliases ?? [])].join(" ");
  const embedding = await embedOrNull(deps.embedder, text);
  return upsertEntity(deps.db, { ...input, embedding });
}

/** Insert a fact, embedding its statement. Provenance still mandatory. */
export async function recordFact(
  deps: EncodeDeps,
  input: Omit<InsertFactInput, "embedding"> & { embedText?: string },
): Promise<Fact> {
  const embedding = await embedOrNull(
    deps.embedder,
    input.embedText ?? input.statement,
  );
  return insertFact(deps.db, { ...input, embedding });
}
