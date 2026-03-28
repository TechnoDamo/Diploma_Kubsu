import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProjectRequest,
  ProjectId,
} from "../../shared/types/api";
import { createProject, deleteProject, getProject, listProjects } from "./projects.api";

export function useProjects(page = 1, limit = 20) {
  return useQuery({
    queryKey: ["projects", page, limit],
    queryFn: () => listProjects({ page, limit }),
  });
}

export function useProject(projectId: ProjectId | undefined) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProjectRequest) => createProject(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: ProjectId) => deleteProject(projectId),
    onSuccess: (_, projectId) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.removeQueries({ queryKey: ["project", projectId] });
    },
  });
}
