import { http, HttpResponse } from "msw";
import type {
  AnalysisJobAcceptedResponse,
  ContradictionAnalysisResponse,
  Document,
  DocumentStatus,
  Project,
  ProjectId,
} from "../shared/types/api";

const baseUrl = "http://localhost:8080/api/v1";
const maxFileSizeBytes = 20 * 1024 * 1024;
const supportedUploadTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

type MockDocument = Document & {
  text?: string;
  rawContent: string;
  shouldFailProcessing: boolean;
  statusPollCount: number;
};

type MockJob = {
  projectId: ProjectId;
  response: ContradictionAnalysisResponse;
  pollCount: number;
};

const projects: Project[] = [
  {
    id: 1,
    name: "Corporate Operations",
    description: "Policy and operating manual workspace.",
    document_count: 2,
    created_at: "2026-03-20T10:00:00Z",
    updated_at: "2026-03-20T10:05:00Z",
  },
];

const documents: MockDocument[] = [
  {
    id: 1,
    project_id: 1,
    name: "operations-standard.md",
    size_bytes: 15_000,
    mime_type: "text/markdown",
    status: "indexed",
    created_at: "2026-03-20T10:01:00Z",
    updated_at: "2026-03-20T10:05:00Z",
    text: "Vendor onboarding requires security review, procurement sign-off, and retention tagging.",
    rawContent:
      "# Operations Standard\n\nVendor onboarding requires security review, procurement sign-off, and retention tagging.",
    shouldFailProcessing: false,
    statusPollCount: 3,
  },
  {
    id: 2,
    project_id: 1,
    name: "security-rules.txt",
    size_bytes: 9_800,
    mime_type: "text/plain",
    status: "indexed",
    created_at: "2026-03-20T10:02:00Z",
    updated_at: "2026-03-20T10:06:00Z",
    text: "All privileged access must be reviewed quarterly. Vendors must complete MFA enrollment.",
    rawContent:
      "All privileged access must be reviewed quarterly. Vendors must complete MFA enrollment.",
    shouldFailProcessing: false,
    statusPollCount: 3,
  },
];

const jobs = new Map<number, MockJob>();
let nextProjectId = 2;
let nextDocumentId = 3;
let nextJobId = 1;

function nowIso() {
  return new Date().toISOString();
}

function paginate<T>(items: T[], page: number, limit: number) {
  const start = (page - 1) * limit;
  return items.slice(start, start + limit);
}

function notFound(code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status: 404 });
}

function badRequest(message: string) {
  return HttpResponse.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
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

function recalcProject(projectId: ProjectId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return;
  }
  project.document_count = documents.filter((item) => item.project_id === projectId).length;
  project.updated_at = nowIso();
}

function progressDocument(document: MockDocument) {
  if (document.status !== "uploaded" && document.status !== "processing") {
    return;
  }
  document.statusPollCount += 1;
  if (document.status === "uploaded") {
    document.status = "processing";
  } else if (document.statusPollCount >= 2) {
    document.status = document.shouldFailProcessing ? "failed" : "indexed";
    if (!document.shouldFailProcessing && !document.text) {
      document.text = `Extracted text for ${document.name}.`;
    }
  }
  document.updated_at = nowIso();
}

function parsePositiveInt(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function buildAcceptedJob(projectId: ProjectId): AnalysisJobAcceptedResponse {
  const jobId = nextJobId++;
  const response: AnalysisJobAcceptedResponse = {
    job_id: jobId,
    status: "queued",
    poll_url: `/api/v1/projects/${projectId}/analysis/contradictions/${jobId}`,
  };
  jobs.set(jobId, {
    projectId,
    pollCount: 0,
    response,
  });
  return response;
}

function advanceJob(jobId: number) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }
  job.pollCount += 1;
  const target = documents.find((item) => item.project_id === job.projectId && item.id !== 1);
  if (job.pollCount === 1) {
    job.response = {
      job_id: jobId,
      status: "processing",
      warning_message: "Mock job still running.",
    };
    return job.response;
  }
  job.response = {
    job_id: jobId,
    status: "completed",
    results: target
      ? [
          {
            target_document_id: target.id,
            target_document_name: target.name,
            summary:
              "Operational guidance and security policy diverge on vendor onboarding controls and review cadence.",
            contradictions: [
              {
                base_text: "Vendor onboarding requires procurement sign-off before activation.",
                target_text: "Vendors can be provisioned before review if MFA is enabled.",
                confidence: 0.88,
                explanation:
                  "The first statement requires approval before activation, while the second permits activation first.",
                base_chunk_order: 3,
                target_chunk_order: 2,
              },
            ],
          },
        ]
      : [],
  };
  return job.response;
}

export const handlers = [
  http.get(`${baseUrl}/projects`, ({ request }) => {
    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page") ?? "1") ?? 1;
    const limit = parsePositiveInt(url.searchParams.get("limit") ?? "20") ?? 20;
    return HttpResponse.json({
      items: paginate(projects, page, limit),
      total: projects.length,
      page,
      limit,
    });
  }),

  http.post(`${baseUrl}/projects`, async ({ request }) => {
    const payload = (await request.json()) as Partial<Project>;
    const name = String(payload.name ?? "").trim();
    if (!name) {
      return validation("name", "must not be empty");
    }
    const now = nowIso();
    const project: Project = {
      id: nextProjectId++,
      name,
      description:
        typeof payload.description === "string" && payload.description.trim().length > 0
          ? payload.description.trim()
          : undefined,
      document_count: 0,
      created_at: now,
      updated_at: now,
    };
    projects.unshift(project);
    return HttpResponse.json(project, { status: 201 });
  }),

  http.get(`${baseUrl}/projects/:projectId`, ({ params }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    return HttpResponse.json(project);
  }),

  http.delete(`${baseUrl}/projects/:projectId`, ({ params }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const index = projects.findIndex((item) => item.id === projectId);
    if (index === -1) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    projects.splice(index, 1);
    for (let i = documents.length - 1; i >= 0; i -= 1) {
      if (documents[i].project_id === projectId) {
        documents.splice(i, 1);
      }
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents`, ({ params, request }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page") ?? "1") ?? 1;
    const limit = parsePositiveInt(url.searchParams.get("limit") ?? "20") ?? 20;
    const projectDocuments = documents
      .filter((item) => item.project_id === projectId)
      .map((document) => {
        progressDocument(document);
        return document;
      });
    return HttpResponse.json({
      items: paginate(projectDocuments, page, limit),
      total: projectDocuments.length,
      page,
      limit,
    });
  }),

  http.post(`${baseUrl}/projects/:projectId/documents`, async ({ params, request }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return validation("file", "must be provided");
    }
    if (file.size > maxFileSizeBytes) {
      return HttpResponse.json(
        { error: { code: "FILE_TOO_LARGE", message: "Uploaded file exceeds the maximum allowed size." } },
        { status: 413 },
      );
    }
    if (!supportedUploadTypes.has(file.type)) {
      return HttpResponse.json(
        { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Uploaded file type is not supported." } },
        { status: 415 },
      );
    }

    const now = nowIso();
    const shouldFailProcessing = /broken|fail/i.test(file.name);
    const status: DocumentStatus = "uploaded";
    const document: MockDocument = {
      id: nextDocumentId++,
      project_id: project.id,
      name: String(form.get("display_name") || file.name),
      size_bytes: file.size,
      mime_type: file.type,
      status,
      created_at: now,
      updated_at: now,
      rawContent: await file.text(),
      shouldFailProcessing,
      statusPollCount: 0,
    };
    documents.unshift(document);
    recalcProject(project.id);
    return HttpResponse.json(document, { status: 201 });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents/:documentId`, ({ params }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const documentId = parsePositiveInt(String(params.documentId));
    const document = documents.find(
      (item) => item.project_id === projectId && item.id === documentId,
    );
    if (!document) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    progressDocument(document);
    return HttpResponse.json(document);
  }),

  http.delete(`${baseUrl}/projects/:projectId/documents/:documentId`, ({ params }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const documentId = parsePositiveInt(String(params.documentId));
    const index = documents.findIndex(
      (item) => item.project_id === projectId && item.id === documentId,
    );
    if (index === -1) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    documents.splice(index, 1);
    recalcProject(projectId as ProjectId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents/:documentId/text`, ({ params }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const documentId = parsePositiveInt(String(params.documentId));
    const document = documents.find(
      (item) => item.project_id === projectId && item.id === documentId,
    );
    if (!document) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    progressDocument(document);
    if (document.status !== "indexed" || !document.text) {
      return HttpResponse.json(
        {
          error: {
            code: "DOCUMENT_NOT_READY",
            message: "Document text is not available yet because processing is not finished.",
          },
        },
        { status: 409 },
      );
    }
    return HttpResponse.json({ document_id: document.id, text: document.text });
  }),

  http.get(`${baseUrl}/projects/:projectId/documents/:documentId/content`, ({ params }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const documentId = parsePositiveInt(String(params.documentId));
    const document = documents.find(
      (item) => item.project_id === projectId && item.id === documentId,
    );
    if (!document) {
      return notFound("DOCUMENT_NOT_FOUND", "Document does not exist in this project.");
    }
    return new HttpResponse(document.rawContent, {
      status: 200,
      headers: {
        "Content-Type": document.mime_type,
      },
    });
  }),

  http.post(`${baseUrl}/projects/:projectId/rag/query`, async ({ params, request }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    const payload = (await request.json()) as { question?: string };
    const question = String(payload.question ?? "").trim();
    if (!question) {
      return validation("question", "must not be empty");
    }
    const citations = documents
      .filter((item) => item.project_id === projectId && item.status === "indexed")
      .slice(0, 2)
      .map((item) => ({
        document_id: item.id,
        document_name: item.name,
        snippet: item.text ?? "No snippet available.",
      }));
    return HttpResponse.json({
      answer:
        "Mock answer: the indexed corpus requires procurement review before vendor onboarding and security review for privileged access.",
      citations,
    });
  }),

  http.post(`${baseUrl}/projects/:projectId/analysis/contradictions`, async ({ params, request }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return notFound("PROJECT_NOT_FOUND", "Project does not exist.");
    }
    const payload = (await request.json()) as { base_document_id?: number };
    if (!payload.base_document_id) {
      return validation("base_document_id", "must be provided");
    }
    return HttpResponse.json(buildAcceptedJob(project.id), { status: 202 });
  }),

  http.get(`${baseUrl}/projects/:projectId/analysis/contradictions/:jobId`, ({ params }) => {
    const projectId = parsePositiveInt(String(params.projectId));
    const jobId = parsePositiveInt(String(params.jobId));
    const job = jobId ? jobs.get(jobId) : undefined;
    if (!job || job.projectId !== projectId) {
      return notFound("ANALYSIS_JOB_NOT_FOUND", "Analysis job does not exist in this project.");
    }
    return HttpResponse.json(advanceJob(jobId!) ?? job.response);
  }),

  http.get("http://localhost:8080/healthz", () => HttpResponse.json({ status: "ok" })),

  http.all("*", ({ request }) => badRequest(`Unhandled mock request: ${request.method} ${request.url}`)),
];
