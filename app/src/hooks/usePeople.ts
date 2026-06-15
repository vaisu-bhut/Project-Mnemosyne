import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { peopleApi } from "@/lib/api/endpoints";

export function usePeopleHealth() {
  return useQuery({
    queryKey: ["people", "health"],
    queryFn: peopleApi.health,
  });
}

/** Merge two people the system wrongly split (fold dupe into survivor). */
export function useMergePeople() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ survivorId, dupeId }: { survivorId: string; dupeId: string }) =>
      peopleApi.merge(survivorId, dupeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });
}

export function usePersonBrief(id: string) {
  return useQuery({
    queryKey: ["people", "brief", id],
    queryFn: () => peopleApi.brief(id),
    enabled: Boolean(id),
  });
}
