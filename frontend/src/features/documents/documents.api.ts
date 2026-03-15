import { apiRequest, apiRequestBlob } from "../../shared/api/http";
import type {
  Document,
  DocumentId,
  DocumentListResponse,
  DocumentTextResponse,
  ProjectId,
} from "../../shared/types/api";

type ListDocumentsInput = {
  projectId: ProjectId;
  page?: number;
  limit?: number;
};

export async function listDocuments({
  projectId,
  page = 1,
  limit = 20,
}: ListDocumentsInput): Promise<DocumentListResponse> {
  return apiRequest<DocumentListResponse>(
    `/projects/${projectId}/documents?page=${page}&limit=${limit}`,
  );
}

export async function uploadDocument(input: {
  projectId: ProjectId;
  file: File;
  displayName?: string;
}): Promise<Document> {
  const body = new FormData();
  body.append("file", input.file);
  if (input.displayName) {
    body.append("display_name", input.displayName);
  }
  return apiRequest<Document>(`/projects/${input.projectId}/documents`, {
    method: "POST",
    body,
  });
}

export async function getDocument(input: {
  projectId: ProjectId;
  documentId: DocumentId;
}): Promise<Document> {
  return apiRequest<Document>(
    `/projects/${input.projectId}/documents/${input.documentId}`,
  );
}

export async function deleteDocument(input: {
  projectId: ProjectId;
  documentId: DocumentId;
}): Promise<void> {
  return apiRequest<void>(`/projects/${input.projectId}/documents/${input.documentId}`, {
    method: "DELETE",
  });
}

export async function getDocumentText(input: {
  projectId: ProjectId;
  documentId: DocumentId;
}): Promise<DocumentTextResponse> {
  return apiRequest<DocumentTextResponse>(
    `/projects/${input.projectId}/documents/${input.documentId}/text`,
  );
}

export async function getDocumentContent(input: {
  projectId: ProjectId;
  documentId: DocumentId;
}): Promise<Blob> {
  return apiRequestBlob(
    `/projects/${input.projectId}/documents/${input.documentId}/content`,
  );
}
