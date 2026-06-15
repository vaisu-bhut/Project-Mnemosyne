import { useMutation, useQuery } from "@tanstack/react-query";
import { episodesApi, memoryApi } from "@/lib/api/endpoints";
import type { Mode, RetentionInput, RetrieveInput } from "@/lib/api/types";

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

/** The extraction trace for an open episode (facts derived from it + their
 * reinforcement history). Disabled until an episode id is present. */
export function useEpisodeTrace(
  episodeId: string | null,
  opts: { mode?: Mode; includeSensitive?: boolean } = {},
) {
  return useQuery({
    queryKey: ["episode-trace", episodeId, opts.mode, opts.includeSensitive],
    queryFn: () => episodesApi.trace(episodeId!, opts),
    enabled: Boolean(episodeId),
  });
}

export function useSetRetention() {
  return useMutation({
    mutationFn: (input: RetentionInput) => memoryApi.setRetention(input),
  });
}
