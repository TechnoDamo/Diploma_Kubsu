import { apiRequest } from "../../shared/api/http";
import type {
  ProjectId,
  RagQueryRequest,
  RagQueryResponse,
} from "../../shared/types/api";

export async function queryRag(input: {
  projectId: ProjectId;
  payload: RagQueryRequest;
}): Promise<RagQueryResponse> {
  return apiRequest<RagQueryResponse>(`/projects/${input.projectId}/rag/query`, {
    method: "POST",
    body: input.payload,
  });
}
