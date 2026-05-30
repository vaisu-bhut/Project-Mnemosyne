import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedder } from "../services/embeddings/index.js";

const baseConfig = {
  EMBEDDING_PROVIDER: "dev" as const,
  EMBEDDING_MODEL: "gemini-embedding-001",
  EMBEDDING_BASE_URL: undefined,
  EMBEDDING_API_KEY: undefined,
  EMBEDDING_TASK_TYPE: "RETRIEVAL_DOCUMENT",
  VECTOR_DIM: 1024,
};

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

describe("dev embedder", () => {
  const embedder = createEmbedder(baseConfig);

  it("produces unit-length vectors of the configured dimension", async () => {
    const [v] = await embedder.embed(["hello memory"]);
    expect(v).toHaveLength(1024);
    expect(Math.sqrt(dot(v!, v!))).toBeCloseTo(1, 5);
  });

  it("is deterministic for the same text", async () => {
    const a = await embedder.embedOne("Sara's dad has heart issues");
    const b = await embedder.embedOne("Sara's dad has heart issues");
    expect(a).toEqual(b);
  });

  it("maps different texts to different vectors", async () => {
    const a = await embedder.embedOne("marathon training");
    const b = await embedder.embedOne("grad school applications");
    expect(a).not.toEqual(b);
    expect(dot(a, b)).toBeLessThan(0.99); // not (anti)parallel
  });

  it("preserves input order across a batch", async () => {
    const texts = ["one", "two", "three"];
    const batch = await embedder.embed(texts);
    expect(batch).toHaveLength(3);
    for (let i = 0; i < texts.length; i++) {
      expect(batch[i]).toEqual(await embedder.embedOne(texts[i]!));
    }
  });
});

describe("embedder factory", () => {
  it("throws for qwen without an API key", () => {
    expect(() =>
      createEmbedder({ ...baseConfig, EMBEDDING_PROVIDER: "qwen" }),
    ).toThrow(/EMBEDDING_API_KEY/);
  });

  it("throws for gemini without an API key", () => {
    expect(() =>
      createEmbedder({ ...baseConfig, EMBEDDING_PROVIDER: "gemini" }),
    ).toThrow(/EMBEDDING_API_KEY/);
  });
});

describe("gemini embedder (mocked transport)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const cfg = {
    ...baseConfig,
    EMBEDDING_PROVIDER: "gemini" as const,
    EMBEDDING_API_KEY: "test-key",
    VECTOR_DIM: 4,
  };

  it("sends the right request and L2-normalizes the response", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(
          JSON.stringify({
            embeddings: [{ values: [3, 0, 0, 0] }, { values: [0, 0, 4, 0] }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const embedder = createEmbedder(cfg);
    const out = await embedder.embed(["doc one", "doc two"]);

    // Order preserved + unit length.
    expect(out[0]).toEqual([1, 0, 0, 0]);
    expect(out[1]).toEqual([0, 0, 1, 0]);

    // Request shape.
    expect(captured?.url).toContain(
      "/models/gemini-embedding-001:batchEmbedContents",
    );
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(captured?.init.body as string);
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0].outputDimensionality).toBe(4);
    expect(body.requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
    expect(body.requests[0].content.parts[0].text).toBe("doc one");
  });

  it("surfaces API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota exceeded", { status: 429 })),
    );
    const embedder = createEmbedder(cfg);
    await expect(embedder.embedOne("x")).rejects.toThrow(/429/);
  });
});
