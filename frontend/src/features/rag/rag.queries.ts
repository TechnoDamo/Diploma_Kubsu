import { useMutation } from "@tanstack/react-query";
import type { DocumentId, ProjectId } from "../../shared/types/api";
import { queryRag } from "./rag.api";

type RagInput = {
  question: string;
  targetDocumentIds: DocumentId[];
};

export function useRagQuery(projectId: ProjectId | undefined) {
  return useMutation({
    mutationFn: (input: RagInput) =>
      queryRag({
        projectId: projectId!,
        payload: {
          question: input.question,
          target_document_ids:
            input.targetDocumentIds.length > 0 ? input.targetDocumentIds : undefined,
        },
      }),
  });
}
