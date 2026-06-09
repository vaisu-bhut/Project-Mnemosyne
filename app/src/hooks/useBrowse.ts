import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { episodesApi, factsApi } from "@/lib/api/endpoints";
import type { ListEpisodesParams, ListFactsParams, UpdateFactInput } from "@/lib/api/types";

export const episodeKeys = {
  list: (params: ListEpisodesParams) => ["episodes", params] as const,
};
export const factKeys = {
  list: (params: ListFactsParams) => ["facts", params] as const,
};

export function useEpisodes(params: ListEpisodesParams = {}) {
  return useQuery({
    queryKey: episodeKeys.list(params),
    queryFn: () => episodesApi.list(params),
  });
}

export function useFacts(params: ListFactsParams = {}) {
  return useQuery({
    queryKey: factKeys.list(params),
    queryFn: () => factsApi.list(params),
  });
}

// Invalidate every facts list (any filter) after a mutation.
function invalidateFacts(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["facts"] });
}

export function useUpdateFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFactInput }) =>
      factsApi.update(id, input),
    onSuccess: () => invalidateFacts(qc),
  });
}

export function useDeleteFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => factsApi.remove(id),
    onSuccess: () => invalidateFacts(qc),
  });
}
