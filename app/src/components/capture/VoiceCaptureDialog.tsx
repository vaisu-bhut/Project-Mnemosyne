"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Square, Users, Link2 } from "lucide-react";
import { useTranscribe, useCommitVoiceNote } from "@/hooks/useCapture";
import { ApiError } from "@/lib/api/client";
import { blobToBase64, getMicStream, pickAudioMime } from "@/lib/audio";
import type { CapturePreview } from "@/lib/api/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/common/Spinner";

type Stage = "idle" | "recording" | "transcribing" | "review" | "committing";

export function VoiceCaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<CapturePreview | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcribe = useTranscribe();
  const commit = useCommitVoiceNote();

  function reset() {
    setStage("idle");
    setTranscript("");
    setResult(null);
    chunksRef.current = [];
    recorderRef.current = null;
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
      reset();
    }
    onOpenChange(next);
  }

  async function startRecording() {
    try {
      const stream = await getMicStream();
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        void onRecorded(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setStage("recording");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't access the microphone.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setStage("transcribing");
  }

  async function onRecorded(blob: Blob) {
    try {
      const audio = await blobToBase64(blob);
      const res = await transcribe.mutateAsync({ audio, mimeType: blob.type || "audio/webm" });
      if (!res.transcript) {
        toast.error("No speech detected — try again.");
        reset();
        return;
      }
      setResult(res);
      setTranscript(res.transcript);
      setStage("review");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Transcription failed");
      reset();
    }
  }

  async function save() {
    setStage("committing");
    try {
      const res = await commit.mutateAsync({
        transcript: transcript.trim(),
        artifactKey: result?.artifactKey,
      });
      const { entities, relationships } = res.extraction;
      toast.success(
        `Saved — ${entities} ${entities === 1 ? "person" : "people"}` +
          (relationships ? `, ${relationships} relationship${relationships === 1 ? "" : "s"}` : ""),
      );
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
      setStage("review");
    }
  }

  const people = result?.preview.entities.filter((e) => e.type === "person") ?? [];
  const rels = result?.preview.relationships ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Capture a voice note</DialogTitle>
          <DialogDescription>
            Speak naturally — Mnemosyne transcribes it and links the people you mention. e.g.
            &ldquo;Sarah is meeting Jane about the house listing, bringing Kane, her realtor.&rdquo;
          </DialogDescription>
        </DialogHeader>

        {stage === "idle" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Button size="lg" className="size-20 rounded-full" onClick={startRecording}>
              <Mic className="size-8" />
            </Button>
            <p className="text-sm text-muted-foreground">Tap to record</p>
          </div>
        )}

        {stage === "recording" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Button
              size="lg"
              variant="destructive"
              className="size-20 animate-pulse rounded-full"
              onClick={stopRecording}
            >
              <Square className="size-8" />
            </Button>
            <p className="text-sm text-muted-foreground">Recording… tap to stop</p>
          </div>
        )}

        {stage === "transcribing" && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Spinner /> Transcribing…
          </div>
        )}

        {(stage === "review" || stage === "committing") && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Transcript</label>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {people.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Users className="size-3.5" /> People
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {people.map((p) => (
                    <Badge key={p.name} variant="secondary">
                      {p.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {rels.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Link2 className="size-3.5" /> Connections
                </p>
                <ul className="space-y-1 text-sm">
                  {rels.map((r, i) => (
                    <li key={i}>
                      <span className="font-medium">{r.from}</span> — {r.relation} of{" "}
                      <span className="font-medium">{r.to}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Final links are extracted from the transcript above when you save, so edits count.
            </p>
          </div>
        )}

        {(stage === "review" || stage === "committing") && (
          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={stage === "committing"}>
              Re-record
            </Button>
            <Button onClick={save} disabled={stage === "committing" || !transcript.trim()}>
              {stage === "committing" && <Spinner />}
              Save to memory
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
