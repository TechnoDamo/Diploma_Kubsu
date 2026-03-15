import { useMutation, useQuery } from "@tanstack/react-query";
import type { DocumentId, JobId, ProjectId } from "../../shared/types/api";
import {
  getContradictionAnalysis,
  startContradictionAnalysis,
} from "./analysis.api";

type StartInput = {
  baseDocumentId: DocumentId;
  targetDocumentIds: DocumentId[];
};

export function useStartAnalysis(projectId: ProjectId | undefined) {
  return useMutation({
    mutationFn: (input: StartInput) =>
      startContradictionAnalysis({
        projectId: projectId!,
        payload: {
          base_document_id: input.baseDocumentId,
          target_document_ids:
            input.targetDocumentIds.length > 0 ? input.targetDocumentIds : undefined,
        },
      }),
  });
}

export function useAnalysisJob(projectId: ProjectId | undefined, jobId: JobId | undefined) {
  return useQuery({
    queryKey: ["analysis-job", projectId, jobId],
    queryFn: () => getContradictionAnalysis({ projectId: projectId!, jobId: jobId! }),
    enabled: Boolean(projectId && jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "queued" || status === "processing") {
        return 2000;
      }
      return false;
    },
  });
}
