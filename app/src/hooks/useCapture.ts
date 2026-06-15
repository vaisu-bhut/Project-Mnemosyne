import { useMutation, useQueryClient } from "@tanstack/react-query";
import { captureApi } from "@/lib/api/endpoints";

export function useTranscribe() {
  return useMutation({
    mutationFn: ({ audio, mimeType }: { audio: string; mimeType: string }) =>
      captureApi.transcribe(audio, mimeType),
  });
}

/** Transcribe-only (for voice-driven Ask): returns text, stores nothing. */
export function useTranscribeText() {
  return useMutation({
    mutationFn: ({ audio, mimeType }: { audio: string; mimeType: string }) =>
      captureApi.transcribeText(audio, mimeType),
  });
}

export function useCommitVoiceNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { transcript: string; artifactKey?: string; title?: string }) =>
      captureApi.commit(input),
    onSuccess: () => {
      // A new note changes people, the graph, the dashboard, and memory.
      for (const key of [["people"], ["mind"], ["facts"], ["episodes"], ["briefings"], ["openLoops"]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
