import type { AppConfig } from "../config/index.js";

/**
 * Produces embedding vectors for text. Implementations must return unit-length
 * vectors of exactly `dimension` numbers (cosine-ready, matching the
 * vector_cosine_ops HNSW indexes).
 */
export interface Embedder {
  readonly dimension: number;
  /** Embed a batch of texts; result order matches input order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Convenience for a single text. */
  embedOne(text: string): Promise<number[]>;
}

type EmbeddingConfig = Pick<
  AppConfig,
  | "EMBEDDING_PROVIDER"
  | "EMBEDDING_MODEL"
  | "EMBEDDING_BASE_URL"
  | "EMBEDDING_API_KEY"
  | "EMBEDDING_TASK_TYPE"
  | "VECTOR_DIM"
>;

/** L2-normalize a vector in place and return it (zero vector left as-is). */
function normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm;
  }
  return vec;
}

/**
 * Deterministic local embedder. No network, no secrets — same text always maps
 * to the same unit vector, different texts differ. Good enough for tests and
 * local dev wiring; NOT semantically meaningful. Uses a cheap seeded PRNG per
 * dimension, mixed with a hash of the text.
 */
function createDevEmbedder(dimension: number): Embedder {
  function hashString(s: string): number {
    // FNV-1a 32-bit.
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function embedOneSync(text: string): number[] {
    const seed = hashString(text);
    const vec = new Array<number>(dimension);
    // mulberry32 PRNG seeded by the text hash, producing centered values.
    let state = seed || 1;
    for (let i = 0; i < dimension; i++) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0,1)
      vec[i] = r - 0.5;
    }
    return normalize(vec);
  }

  return {
    dimension,
    async embed(texts) {
      return texts.map(embedOneSync);
    },
    async embedOne(text) {
      return embedOneSync(text);
    },
  };
}

/**
 * Google gemini-embedding-001 via the Gemini API (Google AI Studio key).
 * Requests `outputDimensionality = VECTOR_DIM` (Matryoshka) and L2-normalizes
 * the result — Google only pre-normalizes at the full 3072 dims.
 */
function createGeminiEmbedder(config: EmbeddingConfig): Embedder {
  const apiKey = config.EMBEDDING_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EMBEDDING_PROVIDER=gemini requires EMBEDDING_API_KEY to be set",
    );
  }
  const dimension = config.VECTOR_DIM;
  const model = config.EMBEDDING_MODEL;
  const base = (
    config.EMBEDDING_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/, "");
  const url = `${base}/models/${model}:batchEmbedContents`;
  const headers = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };

  async function embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dimension,
          taskType: config.EMBEDDING_TASK_TYPE,
        })),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini embedding failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { embeddings: { values: number[] }[] };
    return json.embeddings.map((e) => normalize(e.values.slice()));
  }

  return {
    dimension,
    embed,
    async embedOne(text) {
      const [v] = await embed([text]);
      if (!v) throw new Error("Embedding response was empty");
      return v;
    },
  };
}

/**
 * Qwen text-embedding-v3 via an OpenAI-compatible `/embeddings` endpoint
 * (DashScope compatible mode). Requests `dimensions = VECTOR_DIM` so output
 * width matches the schema.
 */
function createQwenEmbedder(config: EmbeddingConfig): Embedder {
  const apiKey = config.EMBEDDING_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EMBEDDING_PROVIDER=qwen requires EMBEDDING_API_KEY to be set",
    );
  }
  const dimension = config.VECTOR_DIM;
  const base =
    config.EMBEDDING_BASE_URL ??
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const url = `${base.replace(/\/$/, "")}/embeddings`;

  async function embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.EMBEDDING_MODEL,
        input: texts,
        dimensions: dimension,
        encoding_format: "float",
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Embedding request failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    return json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  return {
    dimension,
    embed,
    async embedOne(text) {
      const [v] = await embed([text]);
      if (!v) throw new Error("Embedding response was empty");
      return v;
    },
  };
}

/** Build the configured embedder. Defaults to the deterministic dev embedder. */
export function createEmbedder(config: EmbeddingConfig): Embedder {
  switch (config.EMBEDDING_PROVIDER) {
    case "gemini":
      return createGeminiEmbedder(config);
    case "qwen":
      return createQwenEmbedder(config);
    case "dev":
    default:
      return createDevEmbedder(config.VECTOR_DIM);
  }
}

/**
 * Embedder for search queries. For Gemini, asymmetric retrieval wants the
 * query encoded with RETRIEVAL_QUERY (documents use RETRIEVAL_DOCUMENT); other
 * providers are unaffected.
 */
export function createQueryEmbedder(config: EmbeddingConfig): Embedder {
  return createEmbedder({ ...config, EMBEDDING_TASK_TYPE: "RETRIEVAL_QUERY" });
}
