import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sourcesApi } from "@/lib/api/endpoints";
import type { ClassifySourceInput, CreateSourceInput } from "@/lib/api/types";

export const sourceKeys = {
  all: ["sources"] as const,
};

export function useSources() {
  return useQuery({
    queryKey: sourceKeys.all,
    queryFn: sourcesApi.list,
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSourceInput) => sourcesApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceKeys.all }),
  });
}

export function useClassifySource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ClassifySourceInput }) =>
      sourcesApi.classify(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceKeys.all }),
  });
}

export function useIngestSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sourcesApi.ingest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceKeys.all }),
  });
}

export const ingestStatusKey = (sourceId: string) => ["ingestStatus", sourceId] as const;

/**
 * Poll the latest ingest run for a source while it is active. Polling stops
 * automatically once the run is done/errored (refetchInterval returns false),
 * and the query is disabled unless `enabled` (so idle cards don't poll).
 */
export function useIngestStatus(sourceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ingestStatusKey(sourceId),
    queryFn: () => sourcesApi.ingestStatus(sourceId),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1000 : false;
    },
  });
}
