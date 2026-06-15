"use client";

/** Audio-recording helpers shared by voice capture and voice-driven Ask. */

const MIME_PREFS = ["audio/webm", "audio/mp4", "audio/ogg"];

/** The best-supported recording mime type for this browser, or "" for default. */
export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_PREFS.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/** Strip the data-URL prefix so only the base64 payload is sent. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
