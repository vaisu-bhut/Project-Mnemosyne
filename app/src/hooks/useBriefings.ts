import { useQuery } from "@tanstack/react-query";
import { briefingsApi } from "@/lib/api/endpoints";

export function useUpcomingBriefings(hours = 24) {
  return useQuery({
    queryKey: ["briefings", "upcoming", hours],
    queryFn: () => briefingsApi.upcoming(hours),
  });
}
