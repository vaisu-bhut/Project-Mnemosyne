import { Buffer } from "node:buffer";
import type { AppConfig } from "../config/index.js";
import { fetchWithRetry } from "../util/http.js";

/**
 * Speech-to-text for voice notes + voice-driven Ask. Uses Qwen via DashScope's
 * OpenAI-compatible `audio/transcriptions` endpoint (same base URL and key as
 * the text generator). Embeddings stay on Gemini; ASR no longer uses the
 * Gemini key. Kept as its own provider so the ASR model is explicit.
 */
export interface Transcriber {
  readonly available: boolean;
  /** Transcribe base64-encoded audio of the given mime type to plain text. */
  transcribe(audioBase64: string, mimeType: string): Promise<string>;
}

/** Map a recorder mime type to a filename extension the upstream API understands. */
function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "audio";
}

export function createTranscriber(
  config: Pick<AppConfig, "QWEN_API_KEY" | "QWEN_BASE_URL" | "QWEN_ASR_MODEL">,
): Transcriber {
  const apiKey = config.QWEN_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      async transcribe() {
        throw new Error("Transcription is not configured (QWEN_API_KEY missing).");
      },
    };
  }

  const url = `${config.QWEN_BASE_URL.replace(/\/$/, "")}/audio/transcriptions`;
  const model = config.QWEN_ASR_MODEL;

  return {
    available: true,
    async transcribe(audioBase64, mimeType) {
      const audio = Buffer.from(audioBase64, "base64");
      const form = new FormData();
      form.append(
        "file",
        // Buffer is a Uint8Array, accepted by the Blob constructor on Node 20+.
        new Blob([audio], { type: mimeType }),
        `audio.${extFromMime(mimeType)}`,
      );
      form.append("model", model);

      // DashScope (like every hosted LLM) can 429/503 under load — retry with
      // bounded backoff via the shared helper rather than failing the user.
      const res = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        },
        { maxAttempts: 4 },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (res.status === 429 || res.status === 503) {
          throw new Error(
            "Transcription is rate-limited right now. Try again in a moment.",
          );
        }
        throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 300)}`);
      }
      // OpenAI-compatible Whisper-style response: { text: "..." }.
      const data = (await res.json()) as { text?: string };
      return (data.text ?? "").trim();
    },
  };
}
