import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api/endpoints";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: adminApi.health,
    staleTime: 15_000,
  });
}

export function useContradictions() {
  return useQuery({
    queryKey: ["contradictions"],
    queryFn: adminApi.contradictions,
  });
}

export function useConsolidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.consolidate(),
    onSuccess: () => {
      // Consolidation can change facts, entities, contradictions, and loops.
      for (const key of [["contradictions"], ["people"], ["openLoops"], ["mind"]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useSummarizeEntity(entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.summarizeEntity(entityId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people", "brief", entityId] }),
  });
}
