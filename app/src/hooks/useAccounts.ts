import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi } from "@/lib/api/endpoints";
import { sourceKeys } from "./useSources";

export const accountKeys = {
  all: ["accounts"] as const,
};

export function useAccounts() {
  return useQuery({
    queryKey: accountKeys.all,
    queryFn: accountsApi.list,
  });
}

export function useDisconnectAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountsApi.disconnect(id),
    onSuccess: () => {
      // Disconnecting nulls the binding on any bound sources, so refresh both.
      void qc.invalidateQueries({ queryKey: accountKeys.all });
      void qc.invalidateQueries({ queryKey: sourceKeys.all });
    },
  });
}
