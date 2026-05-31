import { useQuery } from "@tanstack/react-query";
import { openLoopsApi } from "@/lib/api/endpoints";
import type { LoopStatus } from "@/lib/api/types";

export function useOpenLoops(status?: LoopStatus) {
  return useQuery({
    queryKey: ["openLoops", status ?? "all"],
    queryFn: () => openLoopsApi.list(status),
  });
}
