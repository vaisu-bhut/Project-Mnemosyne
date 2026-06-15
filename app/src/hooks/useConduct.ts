import { useMutation } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api/endpoints";

export function useConduct() {
  return useMutation({
    mutationFn: ({ query }: { query: string }) => agentsApi.conduct(query),
  });
}
