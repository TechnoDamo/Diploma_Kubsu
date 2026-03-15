import { http, HttpResponse } from "msw";
import type {
  AnalysisJobStatus,
  ContradictionAnalysisResponse,
  Document,
  DocumentId,
  DocumentStatus,
  JobId,
  Project,
  ProjectId,
} from "../shared/types/api";

const baseUrl = "http://localhost:8080/api/v1";
const maxFileSizeBytes = 20 * 1024 * 1024;
const supportedUploadTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

type MockDocument = Document & {
  text?: string;
  statusPollCount: number;
  shouldFailProcessing: boolean;
  rawContent: string;
};

type MockAnalysisJob = {
  projectId: ProjectId;
  jobId: JobId;
  status: AnalysisJobStatus;
  baseDocumentId: DocumentId;
  targetDocumentIds: DocumentId[];
  pollCount: number;
  shouldFail: boolean;
  response: ContradictionAnalysisResponse;
};

const projects: Project[] = [
  {
    id: "proj_legal",
    name: "Legal Contracts",
    description: "Vendor, NDA, and procurement agreements.",
    document_count: 3,
    created_at: "2026-03-15T18:00:00Z",
    updated_at: "2026-03-15T18:10:00Z",
  },
  {
    id: "proj_policies",
    name: "Compliance Policies",
    description: "Security and process requirements.",
    document_count: 2,
    created_at: "2026-03-14T10:00:00Z",
    updated_at: "2026-03-15T13:20:00Z",
  },
  {
    id: "proj_research",
    name: "Research Notes",
    description: "Cross-paper comparison and evidence extraction.",
    document_count: 1,
    created_at: "2026-03-12T09:00:00Z",
    updated_at: "2026-03-15T07:20:00Z",
  },
];

const documents: MockDocument[] = [
  {
    id: "doc_legal_indexed",
    project_id: "proj_legal",
    name: "master-service-agreement.pdf",
    size_bytes: 180_000,
    mime_type: "application/pdf",
    status: "indexed",
    created_at: "2026-03-15T18:10:00Z",
    updated_at: "2026-03-15T18:13:00Z",
    text: "Payment terms: net 30. Termination: 45 days written notice.",
    statusPollCount: 3,
    shouldFailProcessing: false,
    rawContent: "Mock binary PDF content for master-service-agreement.pdf",
  },
  {
    id: "doc_legal_processing",
    project_id: "proj_legal",
    name: "nda-draft.docx",
    size_bytes: 42_000,
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    status: "processing",
    created_at: "2026-03-15T18:14:00Z",
    updated_at: "2026-03-15T18:14:00Z",
    statusPollCount: 0,
    shouldFailProcessing: false,
    rawContent: "Mock DOCX content for nda-draft.docx",
  },
  {
    id: "doc_legal_failed",
    project_id: "proj_legal",
    name: "broken-contract.pdf",
    size_bytes: 99_000,
    mime_type: "application/pdf",
    status: "failed",
    created_at: "2026-03-15T18:15:00Z",
    updated_at: "2026-03-15T18:16:00Z",
    statusPollCount: 2,
    shouldFailProcessing: true,
    rawContent: "Mock PDF content for broken-contract.pdf",
  },
  {
    id: "doc_policy_indexed",
    project_id: "proj_policies",
    name: "security-policy.md",
    size_bytes: 8_300,
    mime_type: "text/markdown",
    status: "indexed",
    created_at: "2026-03-14T13:00:00Z",
    updated_at: "2026-03-14T13:10:00Z",
    text: "Passwords expire every 60 days. MFA is mandatory.",
    statusPollCount: 4,
    shouldFailProcessing: false,
    rawContent: "# Security Policy\n\nPasswords expire every 60 days.",
  },
  {
    id: "doc_policy_processing",
    project_id: "proj_policies",
    name: "incident-response.txt",
    size_bytes: 5_200,
    mime_type: "text/plain",
    status: "uploaded",
    created_at: "2026-03-15T11:00:00Z",
    updated_at: "2026-03-15T11:00:00Z",
    statusPollCount: 0,
    shouldFailProcessing: false,
    rawContent: "Incident response draft",
  },
  {
    id: "doc_research_indexed",
    project_id: "proj_research",
    name: "paper-notes.txt",
    size_bytes: 2_200,
    mime_type: "text/plain",
    status: "indexed",
    created_at: "2026-03-12T09:10:00Z",
    updated_at: "2026-03-12T09:30:00Z",
    text: "Conclusion from paper A conflicts with assumption in paper B.",
    statusPollCount: 5,
    shouldFailProcessing: false,
    rawContent: "Research note content",
  },
];

const analysisJobs = new Map<JobId, MockAnalysisJob>();
let nextProjectCounter = 100;
let nextDocumentCounter = 300;
let nextJobCounter = 700;

function nowIso() {
  return new Date().toISOString();
}

function badRequest(message: string) {
  return HttpResponse.json(
    { error: { code: "BAD_REQUEST", message } },
    { status: 400 },
  );
}

function notFound(code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status: 404 });
}

function validation(field: string, message: string) {
  return HttpResponse.json(
    {
      error: { code: "VALIDATION_ERROR", message: "Request failed business validation." },
      issues: [{ field, message }],
    },
    { status: 422 },
  );
}

function projectById(projectId: string) {
  return projects.find((item) => item.id === projectId);
}

function projectDocuments(projectId: string) {
  return documents.filter((item) => item.project_id === projectId);
}

function findDocument(projectId: string, documentId: string) {
  return documents.find(
    (item) => item.project_id === projectId && item.id === documentId,
  );
}

function paginate<T>(items: T[], page: number, limit: number) {
  const start = (page - 1) * limit;
  const end = start + limit;
  return items.slice(start, end);
}

function progressDocumentStatus(document: MockDocument) {
  if (document.status === "processing" || document.status === "uploaded") {
    document.statusPollCount += 1;
    if (document.status === "uploaded" && document.statusPollCount >= 1) {
      document.status = "processing";
      document.updated_at = nowIso();
    }
    if (document.status === "processing" && document.statusPollCount >= 3) {
      document.status = document.shouldFailProcessing ? "failed" : "indexed";
      document.updated_at = nowIso();
      if (document.status === "indexed" && !document.text) {
        document.text = `Extracted text for ${document.name}.`;
      }
    }
  }
}

function recalcProjectCounts() {
  for (const project of projects) {
    project.document_count = projectDocuments(project.id).length;
    project.updated_at = nowIso();
  }
}

function createDocumentFromUpload(input: {
  projectId: ProjectId;
  filename: string;
  size: number;
  mimeType: string;
  displayName?: string;
}) {
  nextDocumentCounter += 1;
  const id = `doc_${nextDocumentCounter}` as DocumentId;
  const shouldFail = /fail|broken/i.test(input.filename);
  const status: DocumentStatus = shouldFail ? "processing" : "uploaded";
  const now = nowIso();
  const doc: MockDocument = {
    id,
    project_id: input.projectId,
    name: input.displayName || input.filename,
    size_bytes: input.size,
    mime_type: input.mimeType,
    status,
    created_at: now,
    updated_at: now,
    statusPollCount: 0,
    shouldFailProcessing: shouldFail,
    rawContent: `Uploaded content: ${input.filename}`,
  };
  documents.unshift(doc);
  recalcProjectCounts();
  return doc;
}

function createAnalysisJob(input: {
  projectId: ProjectId;
  baseDocumentId: DocumentId;
  targetDocumentIds: DocumentId[];
}) {
  nextJobCounter += 1;
  const jobId = `job_${nextJobCounter}` as JobId;
  const shouldFail = input.targetDocumentIds.some((id) => id.includes("failed"));

  const initial: ContradictionAnalysisResponse = {
    job_id: jobId,
    status: "queued",
  };

  analysisJobs.set(jobId, {
    projectId: input.projectId,
    jobId,
    status: "queued",
    baseDocumentId: input.baseDocumentId,
    targetDocumentIds: input.targetDocumentIds,
    pollCount: 0,
    shouldFail,
    response: initial,
  });

  return initial;
}

function advanceJob(job: MockAnalysisJob) {
  job.pollCount += 1;
  if (job.pollCount === 1) {
    job.status = "processing";
    job.response = {
      job_id: job.jobId,
      status: "processing",
    };
    return;
  }
  if (job.pollCount >= 2 && (job.status === "queued" || job.status === "processing")) {
    if (job.shouldFail) {
      job.status = "failed";
      job.response = {
        job_id: job.jobId,
        status: "failed",
        error_message: "Model returned inconsistent intermediate embeddings.",
      };
      return;
    }
    const targetIds = job.targetDocumentIds.length
      ? job.targetDocumentIds
      : projectDocuments(job.projectId)
          .map((d) => d.id)
          .filter((id) => id !== job.baseDocumentId);
    job.status = "completed";
    job.response = {
      job_id: job.jobId,
      status: "completed",
      results: targetIds.map((targetId, index) => ({
        target_document_id: targetId,
        contradictions:
          index % 2 === 0
            ? [
                {
                  base_text: "Payment due in 60 days",
                  target_text: "Payment due in 30 days",
                  confidence: 0.84,
                },
              ]
            : [],
      })),
    };
  }
}

export const handlers = [
  http.get(`${baseUrl}/projects`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "20");
    if (Number.isNaN(page) || Number.isNaN(limit) || page < 1 || limit < 1) {
      return badRequest("Request is malformed.");
    }
    return HttpResponse.json({
      items: paginate(projects, page, limit),
      total: projects.length,
      page,
      limit,
    });
  }),

  http.post(`${baseUrl}/projects`, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as
      | { name?: string; description?: string }
      | null;
    if (!body || typeof body.name !== "string") {
      return validation("name", "must not be empty");
    }
    const name = body.name.trim();
    const description = body.description?.trim();
    if (name.length === 0) {
      return validation("name", "must not be empty");
    }
    if (name.length > 200) {
      return validation("name", "must be at most 200 characters");
    }
    if (projects.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      return HttpResponse.json(
        {
          error: {
            code: "PROJECT_ALREADY_EXISTS",
            message: "Project with the same name already exists.",
          },
        },
        { status: 409 },
      );
    }
    nextProjectCounter += 1;
    const now = nowIso();
    const project: Project = {
      id: `proj_${nextProjectCounter}` as ProjectId,
      name,
      description: description || undefined,
      document_count: 0,
      created_at: now,
      updated_at: now,
    };
    projects.unshift(project);
    return HttpResponse.json(project, { status: 201 });
  }),

  http.get(`${baseUrl}/projects/:projectId`, ({ params }) => {
    const project = projectById(String(params.projectId));
    if (!project) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    return HttpResponse.json(project);
  }),

  http.delete(`${baseUrl}/projects/:projectId`, ({ params }) => {
    const projectId = String(params.projectId);
    const index = projects.findIndex((item) => item.id === projectId);
    if (index < 0) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    projects.splice(index, 1);
    for (let i = documents.length - 1; i >= 0; i -= 1) {
      if (documents[i].project_id === projectId) {
        documents.splice(i, 1);
      }
    }
    for (const [jobId, job] of analysisJobs.entries()) {
      if (job.projectId === projectId) {
        analysisJobs.delete(jobId);
      }
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents`, ({ request, params }) => {
    const projectId = String(params.projectId);
    if (!projectById(projectId)) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "20");
    const all = projectDocuments(projectId).map((document) => {
      progressDocumentStatus(document);
      return document;
    });
    return HttpResponse.json({
      items: paginate(all, page, limit),
      total: all.length,
      page,
      limit,
    });
  }),

  http.post(`${baseUrl}/projects/:projectId/documents`, async ({ params, request }) => {
    const projectId = String(params.projectId) as ProjectId;
    if (!projectById(projectId)) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    const formData = await request.formData();
    const file = formData.get("file");
    const displayName = formData.get("display_name");
    if (!(file instanceof File)) {
      return validation("file", "must be provided");
    }
    if (file.size > maxFileSizeBytes) {
      return HttpResponse.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: "Uploaded file exceeds the maximum allowed size.",
          },
        },
        { status: 413 },
      );
    }
    if (!supportedUploadTypes.has(file.type)) {
      return HttpResponse.json(
        {
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Uploaded file type is not supported.",
          },
        },
        { status: 415 },
      );
    }
    const created = createDocumentFromUpload({
      projectId,
      filename: file.name,
      size: file.size,
      mimeType: file.type,
      displayName: typeof displayName === "string" ? displayName : undefined,
    });
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents/:documentId`, ({ params }) => {
    const projectId = String(params.projectId);
    const documentId = String(params.documentId);
    const document = findDocument(projectId, documentId);
    if (!document) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    progressDocumentStatus(document);
    return HttpResponse.json(document);
  }),

  http.delete(`${baseUrl}/projects/:projectId/documents/:documentId`, ({ params }) => {
    const projectId = String(params.projectId);
    const documentId = String(params.documentId);
    const index = documents.findIndex(
      (item) => item.project_id === projectId && item.id === documentId,
    );
    if (index < 0) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    documents.splice(index, 1);
    recalcProjectCounts();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents/:documentId/content`, ({ params }) => {
    const document = findDocument(String(params.projectId), String(params.documentId));
    if (!document) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    return new HttpResponse(document.rawContent, {
      status: 200,
      headers: {
        "Content-Type":
          document.mime_type === "text/plain" || document.mime_type === "text/markdown"
            ? document.mime_type
            : "application/octet-stream",
      },
    });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents/:documentId/text`, ({ params }) => {
    const document = findDocument(String(params.projectId), String(params.documentId));
    if (!document) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    progressDocumentStatus(document);
    if (document.status !== "indexed" || !document.text) {
      return HttpResponse.json(
        {
          error: {
            code: "DOCUMENT_NOT_READY",
            message:
              "Document text is not available yet because processing is not finished.",
          },
        },
        { status: 409 },
      );
    }
    return HttpResponse.json({
      document_id: document.id,
      text: document.text,
    });
  }),

  http.post(`${baseUrl}/projects/:projectId/rag/query`, async ({ params, request }) => {
    const projectId = String(params.projectId);
    if (!projectById(projectId)) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    const body = (await request.json().catch(() => null)) as
      | { question?: string; target_document_ids?: string[] }
      | null;
    if (!body || typeof body.question !== "string" || body.question.trim().length === 0) {
      return validation("question", "must not be empty");
    }
    const candidateDocs =
      Array.isArray(body.target_document_ids) && body.target_document_ids.length > 0
        ? projectDocuments(projectId).filter((doc) =>
            body.target_document_ids?.includes(doc.id),
          )
        : projectDocuments(projectId);
    const indexed = candidateDocs.filter((doc) => doc.status === "indexed");
    return HttpResponse.json({
      answer:
        indexed.length > 0
          ? `Mock answer for: "${body.question.trim()}"`
          : "No indexed documents available yet in this scope.",
      citations: indexed.slice(0, 3).map((doc) => ({
        document_id: doc.id,
        document_name: doc.name,
        snippet: doc.text?.slice(0, 140) || "No text snippet available.",
      })),
    });
  }),

  http.post(
    `${baseUrl}/projects/:projectId/analysis/contradictions`,
    async ({ params, request }) => {
      const projectId = String(params.projectId) as ProjectId;
      if (!projectById(projectId)) {
        return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
      }
      const body = (await request.json().catch(() => null)) as
        | { base_document_id?: string; target_document_ids?: string[] }
        | null;
      if (!body || typeof body.base_document_id !== "string") {
        return validation("base_document_id", "must not be empty");
      }
      const baseDocument = findDocument(projectId, body.base_document_id);
      if (!baseDocument) {
        return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
      }
      const targetIds = (body.target_document_ids || []).filter(
        (id): id is DocumentId => typeof id === "string",
      );
      for (const targetId of targetIds) {
        if (!findDocument(projectId, targetId)) {
          return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
        }
      }
      const accepted = createAnalysisJob({
        projectId,
        baseDocumentId: body.base_document_id as DocumentId,
        targetDocumentIds: targetIds,
      });
      return HttpResponse.json(accepted, { status: 202 });
    },
  ),

  http.get(
    `${baseUrl}/projects/:projectId/analysis/contradictions/:jobId`,
    ({ params }) => {
      const projectId = String(params.projectId);
      const jobId = String(params.jobId) as JobId;
      const job = analysisJobs.get(jobId);
      if (!job || job.projectId !== projectId) {
        return notFound(
          "ANALYSIS_JOB_NOT_FOUND",
          "Analysis job does not exist in this project.",
        );
      }
      advanceJob(job);
      return HttpResponse.json(job.response);
    },
  ),
];
