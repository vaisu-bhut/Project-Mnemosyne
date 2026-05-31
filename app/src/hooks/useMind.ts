import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api/endpoints";

export const mindKeys = { all: ["mind"] as const };

export function useMind(k = 12) {
  return useQuery({
    queryKey: [...mindKeys.all, k],
    queryFn: () => agentsApi.mind(k),
  });
}

export function useDismissMind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentsApi.dismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: mindKeys.all }),
  });
}

export function useRunNudger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => agentsApi.runNudger(),
    onSuccess: () => qc.invalidateQueries({ queryKey: mindKeys.all }),
  });
}
