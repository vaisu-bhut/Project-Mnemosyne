import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, factsApi } from "@/lib/api/endpoints";
import type { FactStatus } from "@/lib/api/types";

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

/** Resolve a contradiction by setting one side's status (stale/retracted). */
export function useResolveContradiction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FactStatus }) =>
      factsApi.update(id, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contradictions"] });
      void qc.invalidateQueries({ queryKey: ["facts"] });
    },
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
