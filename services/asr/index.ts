import type { AppConfig } from "../config/index.js";

/**
 * Speech-to-text for voice notes. Uses Gemini's multimodal generateContent
 * (audio in → transcript out), reusing EMBEDDING_API_KEY (the Google AI Studio
 * key). Kept separate from the text LLM so the transcription model is explicit.
 */
export interface Transcriber {
  readonly available: boolean;
  /** Transcribe base64-encoded audio of the given mime type to plain text. */
  transcribe(audioBase64: string, mimeType: string): Promise<string>;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ASR_MODEL = "gemini-2.5-flash";

const PROMPT =
  "Transcribe this audio note verbatim into clear text. Return ONLY the transcript, " +
  "with no preamble, quotes, or commentary. If there is no intelligible speech, return an empty string.";

export function createTranscriber(config: Pick<AppConfig, "EMBEDDING_API_KEY">): Transcriber {
  const apiKey = config.EMBEDDING_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      async transcribe() {
        throw new Error("Transcription is not configured (EMBEDDING_API_KEY missing).");
      },
    };
  }

  const url = `${GEMINI_BASE}/models/${ASR_MODEL}:generateContent`;
  return {
    available: true,
    async transcribe(audioBase64, mimeType) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inlineData: { mimeType, data: audioBase64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    },
  };
}
