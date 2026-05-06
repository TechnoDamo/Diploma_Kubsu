export type ServerStatus = 'checking' | 'online' | 'offline';

export type ThemeMode = 'system' | 'light' | 'dark';

export type ProjectId = number;
export type DocumentId = number;
export type JobId = number;

export type DocumentStatus = 'uploaded' | 'processing' | 'indexed' | 'failed';

export type Project = {
  id: ProjectId;
  name: string;
  description?: string;
  document_count: number;
  created_at: string;
  updated_at?: string;
};

export type ProjectListResponse = {
  items: Project[];
  total: number;
  page: number;
  limit: number;
};

export type CreateProjectRequest = {
  name: string;
  description?: string;
};

export type Document = {
  id: DocumentId;
  project_id: ProjectId;
  name: string;
  size_bytes: number;
  mime_type: string;
  status: DocumentStatus;
  created_at: string;
  updated_at?: string;
};

export type DocumentListResponse = {
  items: Document[];
  total: number;
  page: number;
  limit: number;
};

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

export type AnalysisJobAcceptedResponse = {
  job_id: JobId;
  status: 'queued' | 'processing';
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

export type ContradictionAnalysisPendingResponse = {
  job_id: JobId;
  status: 'queued' | 'processing';
  warning_message?: string;
};

export type CompletedContradictionAnalysisResponse = {
  job_id: JobId;
  status: 'completed';
  warning_message?: string;
  results: ContradictionResult[];
};

export type FailedContradictionAnalysisResponse = {
  job_id: JobId;
  status: 'failed';
  warning_message?: string;
  error_message: string;
};

export type ContradictionAnalysisResponse =
  | ContradictionAnalysisPendingResponse
  | CompletedContradictionAnalysisResponse
  | FailedContradictionAnalysisResponse;

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export type ValidationApiErrorPayload = ApiErrorPayload & {
  issues: ValidationIssue[];
};

export class ApiError extends Error {
  code?: string;
  status: number;
  issues?: ValidationIssue[];

  constructor(message: string, status: number, code?: string, issues?: ValidationIssue[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export type AskResult = {
  response: RagQueryResponse;
  confidenceScore: number;
};
