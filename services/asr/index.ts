import type { AppConfig } from "../config/index.js";
import { fetchWithRetry } from "../util/http.js";
import OpenAI from "openai";

export interface Transcriber {
  readonly available: boolean;
  /** Transcribe base64-encoded audio of the given mime type to plain text. */
  transcribe(audioBase64: string, mimeType: string): Promise<string>;
}

const PROMPT =
  "Transcribe this audio note verbatim into clear text. Return ONLY the transcript, " +
  "with no preamble, quotes, or commentary. If there is no intelligible speech, return an empty string.";

function formatFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  if (m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("flac")) return "flac";
  if (m.includes("webm") || m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mp4")) return "mp4";
  return "mp3";
}

function normalizeMime(mime: string): string {
  return mime && mime.includes("/") ? mime : "audio/webm";
}

function isNativeMultimodalUrl(url: string): boolean {
  return /\/multimodal-generation(\/|$)/.test(url);
}

/** Pull text out of either response shape: a plain string, or an array of
 * `{ text }` parts (native multimodal returns the latter). */
function pickText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

export function createTranscriber(
  config: Pick<AppConfig, "QWEN_API_KEY" | "QWEN_BASE_URL" | "QWEN_AUDIO_BASE_URL" | "QWEN_ASR_MODEL">,
): Transcriber {
  const apiKey = config.QWEN_API_KEY;
  const model = config.QWEN_ASR_MODEL;
  if (!apiKey || !model) {
    return {
      available: false,
      async transcribe() {
        throw new Error(
          "Transcription is not configured. Set QWEN_API_KEY and QWEN_ASR_MODEL in .env.",
        );
      },
    };
  }
  const override = config.QWEN_AUDIO_BASE_URL?.trim();
  const url = override && override.length > 0
    ? override
    : `${config.QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const native = isNativeMultimodalUrl(url);

  // Initialize OpenAI client if not native
  const openai = native
    ? null
    : new OpenAI({
      apiKey,
      baseURL: override && override.length > 0
        ? override.replace(/\/chat\/completions\/?$/, "")
        : config.QWEN_BASE_URL,
    });

  return {
    available: true,
    async transcribe(audioBase64, mimeType) {
      if (native) {
        // Native multimodal-generation: data URI inside `input.messages`.
        const body = {
          model,
          input: {
            messages: [
              {
                role: "user",
                content: [
                  { audio: `data:${normalizeMime(mimeType)};base64,${audioBase64}` },
                  { text: PROMPT },
                ],
              },
            ],
          },
          parameters: {},
        };

        console.log("[ASR DEBUG] Sending native transcribe request to:", url, "model:", model);
        const res = await fetchWithRetry(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
          },
          { maxAttempts: 4 },
        );
        console.log("[ASR DEBUG] Transcribe response received, status:", res.status, "ok:", res.ok);
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          if (res.status === 429 || res.status === 503) {
            throw new Error("Transcription is rate-limited right now. Try again in a moment.");
          }
          if (res.status === 404 || res.status === 400) {
            throw new Error(
              `Transcription failed (${res.status}) at ${url} with model "${model}". ` +
              `Detail: ${detail.slice(0, 200)}`,
            );
          }
          throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          output?: { choices?: { message?: { content?: unknown } }[] };
        };
        return pickText(data.output?.choices?.[0]?.message?.content).trim();
      }

      // OpenAI-compatible streaming pathway via OpenAI SDK
      console.log("[ASR DEBUG] Sending OpenAI transcribe request with model:", model);
      try {
        const stream = await openai!.chat.completions.create({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: {
                    data: `data:${normalizeMime(mimeType)};base64,${audioBase64}`,
                    format: formatFromMime(mimeType) as any,
                  },
                },
                { type: "text", text: PROMPT },
              ],
            },
          ],
          stream: true,
          stream_options: { include_usage: true },
          modalities: ["text"],
        });

        let out = "";
        for await (const chunk of stream) {
          const text = pickText(chunk.choices?.[0]?.delta?.content);
          out += text;
        }
        return out.trim();
      } catch (err: any) {
        console.error("[ASR DEBUG] OpenAI SDK error:", err);
        const status = err.status || 500;
        if (status === 429 || status === 503) {
          throw new Error("Transcription is rate-limited right now. Try again in a moment.");
        }
        throw new Error(`Transcription failed: ${err.message || err}`);
      }
    },
  };
}
