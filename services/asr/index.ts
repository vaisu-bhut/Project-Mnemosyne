import type { AppConfig } from "../config/index.js";
import { fetchWithRetry } from "../util/http.js";

/**
 * Speech-to-text for voice notes + voice-driven Ask.
 *
 * Uses Qwen-audio via DashScope's NATIVE multimodal-generation endpoint —
 * separate from the OpenAI-compatible /chat/completions URL used for the text
 * LLM. (The intl OpenAI-compatible mode doesn't host audio models; the native
 * endpoint does.) Three .env vars drive this:
 *
 *   QWEN_API_KEY         — shared with the text generator
 *   QWEN_AUDIO_BASE_URL  — e.g. https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 *   QWEN_ASR_MODEL       — e.g. qwen-audio-turbo-latest
 *
 * Audio is sent inline as a `data:` URI; nothing leaves the server except the
 * request to DashScope. Embeddings remain on Gemini.
 */
export interface Transcriber {
  readonly available: boolean;
  /** Transcribe base64-encoded audio of the given mime type to plain text. */
  transcribe(audioBase64: string, mimeType: string): Promise<string>;
}

const PROMPT =
  "Transcribe this audio note verbatim into clear text. Return ONLY the transcript, " +
  "with no preamble, quotes, or commentary. If there is no intelligible speech, return an empty string.";

/** Browser MediaRecorder emits audio/webm by default; Qwen-audio accepts that
 * mime directly inside a data URI, so pass the recorder mime through and only
 * fall back when it's missing. */
function normalizeMime(mime: string): string {
  return mime && mime.includes("/") ? mime : "audio/webm";
}

/** Extract the transcript text from DashScope's native multimodal response.
 * The shape is { output: { choices: [ { message: { content: ... } } ] } } and
 * `content` may be a string or an array of `{ text }` parts depending on model. */
function extractTranscript(data: unknown): string {
  const root = data as {
    output?: { choices?: { message?: { content?: unknown } }[] };
  };
  const content = root.output?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
      .join("")
      .trim();
  }
  return "";
}

export function createTranscriber(
  config: Pick<AppConfig, "QWEN_API_KEY" | "QWEN_AUDIO_BASE_URL" | "QWEN_ASR_MODEL">,
): Transcriber {
  const apiKey = config.QWEN_API_KEY;
  const url = config.QWEN_AUDIO_BASE_URL;
  const model = config.QWEN_ASR_MODEL;

  if (!apiKey || !url || !model) {
    return {
      available: false,
      async transcribe() {
        throw new Error(
          "Transcription is not configured. Set QWEN_API_KEY, QWEN_AUDIO_BASE_URL, and QWEN_ASR_MODEL in .env.",
        );
      },
    };
  }

  return {
    available: true,
    async transcribe(audioBase64, mimeType) {
      const dataUri = `data:${normalizeMime(mimeType)};base64,${audioBase64}`;
      const body = {
        model,
        input: {
          messages: [
            {
              role: "user",
              content: [{ audio: dataUri }, { text: PROMPT }],
            },
          ],
        },
        parameters: {},
      };

      // DashScope can 429/503 under load — bounded backoff via the shared helper.
      const res = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        { maxAttempts: 4 },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (res.status === 429 || res.status === 503) {
          throw new Error("Transcription is rate-limited right now. Try again in a moment.");
        }
        if (res.status === 404 || res.status === 400) {
          throw new Error(
            `Transcription failed (${res.status}). Verify QWEN_ASR_MODEL ("${model}") is ` +
              `enabled on your DashScope tenant and that QWEN_AUDIO_BASE_URL points at the ` +
              `native multimodal-generation endpoint. Detail: ${detail.slice(0, 200)}`,
          );
        }
        throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 300)}`);
      }

      const data = (await res.json()) as unknown;
      return extractTranscript(data);
    },
  };
}
