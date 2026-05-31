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
