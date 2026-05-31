import type { AppConfig } from "../config/index.js";

/**
 * Minimal text-generation interface used by extraction and grounded answering.
 * `generateJson` asks the model for a JSON document and parses it.
 */
export interface TextGenerator {
  readonly available: boolean;
  generateText(prompt: string): Promise<string>;
  generateJson<T>(prompt: string): Promise<T>;
}

type LlmConfig = Pick<
  AppConfig,
  | "LLM_PROVIDER"
  | "LLM_MODEL"
  | "EMBEDDING_API_KEY"
  | "QWEN_API_KEY"
  | "QWEN_MODEL"
  | "QWEN_BASE_URL"
>;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Strip ```json fences some models wrap around JSON. */
function stripFences(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1]! : t;
}

function createGeminiGenerator(config: LlmConfig): TextGenerator {
  const apiKey = config.EMBEDDING_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LLM_PROVIDER=gemini requires EMBEDDING_API_KEY (the Google AI Studio key)",
    );
  }
  const model = config.LLM_MODEL;
  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const headers = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };

  async function call(prompt: string, json: boolean): Promise<string> {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM request failed (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  return {
    available: true,
    generateText: (prompt) => call(prompt, false),
    async generateJson<T>(prompt: string): Promise<T> {
      const raw = await call(prompt, true);
      return JSON.parse(stripFences(raw)) as T;
    },
  };
}

/**
 * Qwen chat via DashScope's OpenAI-compatible Chat Completions endpoint.
 * Used for extraction, grounded answers, and semantic adjudication.
 */
function createQwenGenerator(config: LlmConfig): TextGenerator {
  const apiKey = config.QWEN_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_PROVIDER=qwen requires QWEN_API_KEY");
  }
  const model = config.QWEN_MODEL;
  const url = `${config.QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  async function call(prompt: string, json: boolean): Promise<string> {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM request failed (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  return {
    available: true,
    generateText: (prompt) => call(prompt, false),
    async generateJson<T>(prompt: string): Promise<T> {
      const raw = await call(prompt, true);
      return JSON.parse(stripFences(raw)) as T;
    },
  };
}

/**
 * Dev generator: no network. `generateText` returns a clearly-marked stand-in;
 * `generateJson` is unsupported (the dev extractor uses heuristics, not the LLM).
 */
function createDevGenerator(): TextGenerator {
  return {
    available: false,
    async generateText() {
      return "[dev generator: set LLM_PROVIDER=qwen for real answers]";
    },
    async generateJson<T>(): Promise<T> {
      throw new Error("generateJson is not available with LLM_PROVIDER=dev");
    },
  };
}

export function createGenerator(config: LlmConfig): TextGenerator {
  switch (config.LLM_PROVIDER) {
    case "qwen":
      return createQwenGenerator(config);
    case "gemini":
      return createGeminiGenerator(config);
    default:
      return createDevGenerator();
  }
}
