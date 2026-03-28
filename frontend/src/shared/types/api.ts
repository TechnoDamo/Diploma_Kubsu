export type ProjectId = number;
export type DocumentId = number;
export type JobId = number;

export type Project = {
  id: ProjectId;
  name: string;
  description?: string;
  document_count: number;
  created_at: string;
  updated_at: string;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export type ProjectListResponse = Paginated<Project>;

export type CreateProjectRequest = {
  name: string;
  description?: string;
};

export type DocumentStatus = "uploaded" | "processing" | "indexed" | "failed";

export type Document = {
  id: DocumentId;
  project_id: ProjectId;
  name: string;
  size_bytes: number;
  mime_type: string;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
};

export type DocumentListResponse = Paginated<Document>;

export type DocumentTextResponse = {
  document_id: DocumentId;
  text: string;
};

export type RagQueryRequest = {
  question: string;
  target_document_ids?: DocumentId[];
};

export type Citation = {
  document_id: DocumentId;
  document_name: string;
  snippet: string;
};

export type RagQueryResponse = {
  answer: string;
  warning_message?: string;
  citations: Citation[];
};

export type StartContradictionAnalysisRequest = {
  base_document_id: DocumentId;
  target_document_ids?: DocumentId[];
};

export type AnalysisJobStatus = "queued" | "processing" | "completed" | "failed";

export type AnalysisJobAcceptedResponse = {
  job_id: JobId;
  status: AnalysisJobStatus;
  poll_url: string;
  warning_message?: string;
};

export type Contradiction = {
  base_text: string;
  target_text: string;
  confidence: number;
  explanation: string;
  base_chunk_order: number;
  target_chunk_order: number;
};

export type ContradictionResult = {
  target_document_id: DocumentId;
  target_document_name: string;
  summary: string;
  contradictions: Contradiction[];
};

export type ContradictionAnalysisResponse = {
  job_id: JobId;
  status: AnalysisJobStatus;
  poll_url?: string;
  warning_message?: string;
  results?: ContradictionResult[];
  error_message?: string;
};

export type ErrorDetail = {
  code: string;
  message: string;
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export type ErrorResponse = {
  error: ErrorDetail;
};

export type ValidationErrorResponse = ErrorResponse & {
  issues: ValidationIssue[];
};

export type ApiError =
  | {
      kind: "error";
      status: number;
      code: string;
      message: string;
    }
  | {
      kind: "validation";
      status: number;
      code: string;
      message: string;
      issues: ValidationIssue[];
    };
