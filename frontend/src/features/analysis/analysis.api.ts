import { apiRequest } from "../../shared/api/http";
import type {
  AnalysisJobAcceptedResponse,
  ContradictionAnalysisResponse,
  ProjectId,
  StartContradictionAnalysisRequest,
  JobId,
} from "../../shared/types/api";

export async function startContradictionAnalysis(input: {
  projectId: ProjectId;
  payload: StartContradictionAnalysisRequest;
}): Promise<AnalysisJobAcceptedResponse> {
  return apiRequest<AnalysisJobAcceptedResponse>(
    `/projects/${input.projectId}/analysis/contradictions`,
    {
      method: "POST",
      body: input.payload,
    },
  );
}

export async function getContradictionAnalysis(input: {
  projectId: ProjectId;
  jobId: JobId;
}): Promise<ContradictionAnalysisResponse> {
  return apiRequest<ContradictionAnalysisResponse>(
    `/projects/${input.projectId}/analysis/contradictions/${input.jobId}`,
  );
}
