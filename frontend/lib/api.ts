import {
  type AnalysisJobAcceptedResponse,
  ApiError,
  type ContradictionAnalysisResponse,
  type CreateProjectRequest,
  type Document,
  type DocumentId,
  type DocumentListResponse,
  type DocumentTextResponse,
  type JobId,
  type Project,
  type ProjectId,
  type ProjectListResponse,
  type RagQueryRequest,
  type RagQueryResponse,
  type StartContradictionAnalysisRequest,
  type ValidationApiErrorPayload,
  type ApiErrorPayload
} from '@/lib/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api/v1';
const CLIENT_ID_STORAGE_KEY = 'rag-demo-client-id';

function resolveUrl(path: string): string {
  const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const nextPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${nextPath}`;
}

function getOrCreateClientId(): string | null {
  if (typeof window === 'undefined') return null;

  const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) return existing;

  const generated = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
  return generated;
}

function buildHeaders(accept: string, initHeaders?: HeadersInit): Headers {
  const headers = new Headers(initHeaders);
  headers.set('Accept', accept);

  const clientId = getOrCreateClientId();
  if (clientId) {
    headers.set('X-Client-Id', clientId);
  }

  return headers;
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as ApiErrorPayload | ValidationApiErrorPayload;
    const fallbackMessage = `Request failed with ${response.status}`;
    return new ApiError(
      payload.error?.message ?? fallbackMessage,
      response.status,
      payload.error?.code,
      'issues' in payload ? payload.issues : undefined
    );
  } catch {
    return new ApiError(`Request failed with ${response.status}`, response.status);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const headers = isFormData
    ? buildHeaders('*/*', init?.headers)
    : buildHeaders('application/json', init?.headers);
  if (isFormData) {
    headers.delete('Content-Type');
  }
  const response = await fetch(resolveUrl(path), {
    ...init,
    headers,
    cache: 'no-store'
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function requestRaw(path: string): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(resolveUrl(path), {
    headers: buildHeaders('*/*'),
    cache: 'no-store'
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream'
  };
}

export const ragApi = {
  baseUrl: API_BASE_URL,

  async ping(): Promise<void> {
    await requestJson<ProjectListResponse>('/projects?page=1&limit=1');
  },

  async listProjects(page = 1, limit = 50): Promise<ProjectListResponse> {
    return requestJson<ProjectListResponse>(`/projects?page=${page}&limit=${limit}`);
  },

  async createProject(payload: CreateProjectRequest): Promise<Project> {
    return requestJson<Project>('/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  },

  async getProject(projectId: ProjectId): Promise<Project> {
    return requestJson<Project>(`/projects/${projectId}`);
  },

  async deleteProject(projectId: ProjectId): Promise<void> {
    await requestJson<void>(`/projects/${projectId}`, {
      method: 'DELETE'
    });
  },

  async listDocuments(projectId: ProjectId, page = 1, limit = 50): Promise<DocumentListResponse> {
    return requestJson<DocumentListResponse>(
      `/projects/${projectId}/documents?page=${page}&limit=${limit}`
    );
  },

  async uploadDocument(projectId: ProjectId, file: File, displayName?: string): Promise<Document> {
    const formData = new FormData();
    formData.append('file', file);

    if (displayName?.trim()) {
      formData.append('display_name', displayName.trim());
    }

    return requestJson<Document>(`/projects/${projectId}/documents`, {
      method: 'POST',
      body: formData
    });
  },

  async getDocument(projectId: ProjectId, documentId: DocumentId): Promise<Document> {
    return requestJson<Document>(`/projects/${projectId}/documents/${documentId}`);
  },

  async deleteDocument(projectId: ProjectId, documentId: DocumentId): Promise<void> {
    await requestJson<void>(`/projects/${projectId}/documents/${documentId}`, {
      method: 'DELETE'
    });
  },

  async getDocumentContent(
    projectId: ProjectId,
    documentId: DocumentId
  ): Promise<{ blob: Blob; contentType: string }> {
    return requestRaw(`/projects/${projectId}/documents/${documentId}/content`);
  },

  async getDocumentText(projectId: ProjectId, documentId: DocumentId): Promise<DocumentTextResponse> {
    return requestJson<DocumentTextResponse>(`/projects/${projectId}/documents/${documentId}/text`);
  },

  async queryRag(projectId: ProjectId, payload: RagQueryRequest): Promise<RagQueryResponse> {
    return requestJson<RagQueryResponse>(`/projects/${projectId}/rag/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  },

  async startContradictionAnalysis(
    projectId: ProjectId,
    payload: StartContradictionAnalysisRequest
  ): Promise<AnalysisJobAcceptedResponse> {
    return requestJson<AnalysisJobAcceptedResponse>(`/projects/${projectId}/analysis/contradictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  },

  async getContradictionAnalysis(
    projectId: ProjectId,
    jobId: JobId
  ): Promise<ContradictionAnalysisResponse | RagQueryResponse> {
    return requestJson<ContradictionAnalysisResponse | RagQueryResponse>(
      `/projects/${projectId}/analysis/contradictions/${jobId}`
    );
  },

  async listAnalysisJobs(projectId: ProjectId): Promise<{ items: any[] }> {
    return requestJson<{ items: any[] }>(
      `/projects/${projectId}/analysis/contradictions`
    );
  },

  async deleteAnalysisJob(projectId: ProjectId, jobId: JobId): Promise<void> {
    await requestJson<void>(`/projects/${projectId}/analysis/contradictions/${jobId}`, {
      method: 'DELETE'
    });
  }
};
