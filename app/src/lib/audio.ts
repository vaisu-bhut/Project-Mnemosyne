"use client";

/** Audio-recording helpers shared by voice capture and voice-driven Ask. */

const MIME_PREFS = ["audio/webm", "audio/mp4", "audio/ogg"];

/** The best-supported recording mime type for this browser, or "" for default. */
export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_PREFS.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/**
 * Acquire a microphone stream with precise, actionable errors. The usual
 * "permission is granted but it still fails" cause is a non-secure context:
 * browsers only expose navigator.mediaDevices on http://localhost / 127.0.0.1
 * or HTTPS — open the app via a LAN IP and mediaDevices is simply undefined.
 */
export async function getMicStream(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw new Error(
        "Microphone needs a secure page. Open the app at http://localhost:3001 " +
          "(not a 192.168.x.x / network URL) or over HTTPS.",
      );
    }
    throw new Error("This browser doesn't support microphone recording.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error(
        "Microphone blocked for this site. Click the mic/lock icon in the address " +
          "bar, allow access, then try again.",
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new Error("No microphone found. Connect an input device and retry.");
    }
    if (name === "NotReadableError") {
      throw new Error("Your microphone is in use by another app or tab. Close it and retry.");
    }
    throw new Error("Couldn't access the microphone.");
  }
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
