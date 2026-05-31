import { useMutation } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api/endpoints";
import type { Mode } from "@/lib/api/types";

export function useConduct() {
  return useMutation({
    mutationFn: ({
      query,
      mode,
      includeSensitive,
    }: {
      query: string;
      mode?: Mode;
      includeSensitive?: boolean;
    }) => agentsApi.conduct(query, { mode, includeSensitive }),
  });
}
