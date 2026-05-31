import { useQuery } from "@tanstack/react-query";
import { peopleApi } from "@/lib/api/endpoints";

export function usePeopleHealth() {
  return useQuery({
    queryKey: ["people", "health"],
    queryFn: peopleApi.health,
  });
}

export function usePersonBrief(id: string) {
  return useQuery({
    queryKey: ["people", "brief", id],
    queryFn: () => peopleApi.brief(id),
    enabled: Boolean(id),
  });
}
