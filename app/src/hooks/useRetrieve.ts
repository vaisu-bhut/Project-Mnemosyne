import { useMutation } from "@tanstack/react-query";
import { memoryApi } from "@/lib/api/endpoints";
import type { RetentionInput, RetrieveInput } from "@/lib/api/types";

export function useSearch() {
  return useMutation({
    mutationFn: ({ query, opts }: { query: string; opts: RetrieveInput }) =>
      memoryApi.search(query, opts),
  });
}

export function useAsk() {
  return useMutation({
    mutationFn: ({ question, opts }: { question: string; opts: RetrieveInput }) =>
      memoryApi.ask(question, opts),
  });
}

export function useForgetEpisode() {
  return useMutation({
    mutationFn: (episodeId: string) => memoryApi.forget(episodeId),
  });
}

export function useSetRetention() {
  return useMutation({
    mutationFn: (input: RetentionInput) => memoryApi.setRetention(input),
  });
}
