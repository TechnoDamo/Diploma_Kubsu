import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { DocumentId, ProjectId } from "../../shared/types/api";
import {
  deleteDocument,
  getDocument,
  getDocumentContent,
  getDocumentText,
  listDocuments,
  uploadDocument,
} from "./documents.api";

export function useDocuments(projectId: ProjectId | undefined, page = 1, limit = 20) {
  return useQuery({
    queryKey: ["documents", projectId, page, limit],
    queryFn: () => listDocuments({ projectId: projectId!, page, limit }),
    enabled: Boolean(projectId),
  });
}

export function useDocument(projectId: ProjectId | undefined, documentId: DocumentId | undefined) {
  return useQuery({
    queryKey: ["document", projectId, documentId],
    queryFn: () => getDocument({ projectId: projectId!, documentId: documentId! }),
    enabled: Boolean(projectId && documentId),
  });
}

export function useDocumentText(
  projectId: ProjectId | undefined,
  documentId: DocumentId | undefined,
) {
  return useQuery({
    queryKey: ["document-text", projectId, documentId],
    queryFn: () => getDocumentText({ projectId: projectId!, documentId: documentId! }),
    enabled: Boolean(projectId && documentId),
    retry: false,
  });
}

export function useDocumentContent(
  projectId: ProjectId | undefined,
  documentId: DocumentId | undefined,
) {
  return useQuery({
    queryKey: ["document-content", projectId, documentId],
    queryFn: () => getDocumentContent({ projectId: projectId!, documentId: documentId! }),
    enabled: false,
  });
}

export function useUploadDocument(projectId: ProjectId | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; displayName?: string }) =>
      uploadDocument({
        projectId: projectId!,
        file: input.file,
        displayName: input.displayName,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}

export function useDeleteDocument(projectId: ProjectId | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: DocumentId) =>
      deleteDocument({ projectId: projectId!, documentId }),
    onSuccess: (_, documentId) => {
      void queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.removeQueries({
        queryKey: ["document", projectId, documentId],
      });
    },
  });
}
