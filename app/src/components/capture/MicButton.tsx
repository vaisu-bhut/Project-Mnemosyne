"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Square } from "lucide-react";
import { useTranscribeText } from "@/hooks/useCapture";
import { ApiError } from "@/lib/api/client";
import { blobToBase64, pickAudioMime } from "@/lib/audio";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/common/Spinner";
import { cn } from "@/lib/utils";

/** Push-to-talk mic: record → transcribe → hand the text back. Read-only and
 * explicitly invoked (never an always-on mic). Reused wherever speech-to-text
 * should fill a text input — e.g. the Ask panel. */
export function MicButton({
  onTranscript,
  disabled,
  title = "Ask by voice",
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcribe = useTranscribeText();

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void finish(new Blob(chunksRef.current, { type: rec.mimeType }));
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Couldn't access the microphone. Check browser permissions.");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function finish(blob: Blob) {
    try {
      const audio = await blobToBase64(blob);
      const { transcript } = await transcribe.mutateAsync({
        audio,
        mimeType: blob.type || "audio/webm",
      });
      if (transcript.trim()) onTranscript(transcript.trim());
      else toast.error("No speech detected — try again.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Transcription failed");
    }
  }

  const busy = transcribe.isPending;

  return (
    <Button
      type="button"
      size="icon"
      variant={recording ? "destructive" : "ghost"}
      className={cn(recording && "animate-pulse")}
      title={recording ? "Stop" : title}
      disabled={disabled || busy}
      onClick={recording ? stop : start}
    >
      {busy ? <Spinner /> : recording ? <Square className="size-4" /> : <Mic className="size-4" />}
      <span className="sr-only">{recording ? "Stop recording" : title}</span>
    </Button>
  );
}
