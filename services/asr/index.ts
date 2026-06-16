import type { AppConfig } from "../config/index.js";
import { fetchWithRetry } from "../util/http.js";

/**
 * Speech-to-text for voice notes + voice-driven Ask. Uses Qwen via DashScope's
 * OpenAI-compatible `chat/completions` endpoint with multimodal audio input
 * (an "input_audio" content part). DashScope intl does NOT expose the Whisper
 * `audio/transcriptions` endpoint — only chat/completions — so this is the only
 * path that works on the international tenant. Embeddings stay on Gemini; ASR
 * shares QWEN_API_KEY + QWEN_BASE_URL with the text generator.
 */
export interface Transcriber {
  readonly available: boolean;
  /** Transcribe base64-encoded audio of the given mime type to plain text. */
  transcribe(audioBase64: string, mimeType: string): Promise<string>;
}

const PROMPT =
  "Transcribe this audio note verbatim into clear text. Return ONLY the transcript, " +
  "with no preamble, quotes, or commentary. If there is no intelligible speech, return an empty string.";

/** Map a recorder mime type to a Qwen-audio format hint. Browser MediaRecorder
 * typically produces audio/webm (Opus-in-WebM); Qwen-audio expects an explicit
 * container hint, so normalize to the closest supported format. */
function formatFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  if (m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("flac")) return "flac";
  // Both webm-audio (Opus-in-WebM, Chrome default) and ogg-audio (Opus-in-Ogg,
  // Firefox default) are Opus payloads; report them as ogg for Qwen-audio.
  if (m.includes("webm") || m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mp4")) return "mp4";
  return "mp3";
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

  const url = `${config.QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const model = config.QWEN_ASR_MODEL;

  return {
    available: true,
    async transcribe(audioBase64, mimeType) {
      const format = formatFromMime(mimeType);
      const body = {
        model,
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "input_audio", input_audio: { data: audioBase64, format } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
        temperature: 0,
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
          throw new Error(
            "Transcription is rate-limited right now. Try again in a moment.",
          );
        }
        if (res.status === 404 || res.status === 400) {
          throw new Error(
            `Transcription model "${model}" is not available on this DashScope ` +
              `tenant (${res.status}). Set QWEN_ASR_MODEL to an audio model your ` +
              `tenant exposes — e.g. qwen-audio-turbo-latest, qwen2-audio-instruct, ` +
              `or qwen3-omni-flash.`,
          );
        }
        throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = data.choices?.[0]?.message?.content ?? "";
      return raw.trim();
    },
  };
}
