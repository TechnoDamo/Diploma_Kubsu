import { apiRequest } from "../../shared/api/http";
import type {
  CreateProjectRequest,
  Project,
  ProjectListResponse,
  ProjectId,
} from "../../shared/types/api";

type ListProjectsInput = {
  page?: number;
  limit?: number;
};

export async function listProjects({
  page = 1,
  limit = 20,
}: ListProjectsInput = {}): Promise<ProjectListResponse> {
  return apiRequest<ProjectListResponse>(`/projects?page=${page}&limit=${limit}`);
}

export async function getProject(projectId: string): Promise<Project> {
  return apiRequest<Project>(`/projects/${projectId}`);
}

export async function createProject(payload: CreateProjectRequest): Promise<Project> {
  return apiRequest<Project>("/projects", {
    method: "POST",
    body: payload,
  });
}

export async function deleteProject(projectId: ProjectId): Promise<void> {
  return apiRequest<void>(`/projects/${projectId}`, {
    method: "DELETE",
  });
}
