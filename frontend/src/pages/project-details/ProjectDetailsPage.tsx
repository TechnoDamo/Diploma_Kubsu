import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useDeleteDocument,
  useDocuments,
  useUploadDocument,
} from "../../features/documents/documents.queries";
import { useStartAnalysis } from "../../features/analysis/analysis.queries";
import { useProject } from "../../features/projects/projects.queries";
import { useRagQuery } from "../../features/rag/rag.queries";
import { readApiErrorMessage } from "../../shared/api/errors";
import { parseRouteId } from "../../shared/lib/ids";
import type { Document, DocumentId, ProjectId } from "../../shared/types/api";
import { AppShell } from "../../shared/ui/AppShell";

function renderStatus(status: Document["status"]) {
  if (status === "indexed") return <span className="status status-ok">indexed</span>;
  if (status === "failed") return <span className="status status-bad">failed</span>;
  if (status === "processing") return <span className="status status-warn">processing</span>;
  return <span className="status">{status}</span>;
}

export function ProjectDetailsPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const typedProjectId = parseRouteId(projectId) as ProjectId | undefined;

  const [uploadDisplayName, setUploadDisplayName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [targetDocumentIds, setTargetDocumentIds] = useState<DocumentId[]>([]);
  const [baseDocumentId, setBaseDocumentId] = useState<DocumentId | "">("");
  const [analysisTargets, setAnalysisTargets] = useState<DocumentId[]>([]);

  const projectQuery = useProject(typedProjectId);
  const documentsQuery = useDocuments(typedProjectId);
  const uploadMutation = useUploadDocument(typedProjectId);
  const deleteMutation = useDeleteDocument(typedProjectId);
  const ragMutation = useRagQuery(typedProjectId);
  const startAnalysisMutation = useStartAnalysis(typedProjectId);

  const documents = documentsQuery.data?.items ?? [];
  const indexedDocuments = documents.filter((document) => document.status === "indexed");
  const processingDocuments = documents.filter(
    (document) => document.status === "uploaded" || document.status === "processing",
  );
  const refetchDocuments = documentsQuery.refetch;
  const refetchProject = projectQuery.refetch;

  useEffect(() => {
    if (processingDocuments.length === 0) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refetchDocuments();
      void refetchProject();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [processingDocuments.length, refetchDocuments, refetchProject]);

  useEffect(() => {
    if (typeof baseDocumentId !== "number") {
      return;
    }
    setAnalysisTargets((current) => current.filter((id) => id !== baseDocumentId));
  }, [baseDocumentId]);

  const ragError = ragMutation.isError
    ? readApiErrorMessage(ragMutation.error, "Failed to execute query.")
    : null;
  const analysisError = startAnalysisMutation.isError
    ? readApiErrorMessage(
        startAnalysisMutation.error,
        "Failed to start contradiction analysis.",
      )
    : null;

  const canSubmitQuestion = useMemo(() => question.trim().length > 0, [question]);
  const canSubmitAnalysis = useMemo(
    () => typeof baseDocumentId === "number",
    [baseDocumentId],
  );
  const uploadHint = "Supported today: txt, md, pdf, docx. PDF and DOCX still depend on Docling readiness.";

  if (!typedProjectId) {
    return (
      <AppShell
        title="Invalid Project"
        subtitle="The requested project route is malformed."
      >
        <section className="panel">
          <p className="error">Project ID must be a positive integer.</p>
          <Link to="/projects">Return to projects</Link>
        </section>
      </AppShell>
    );
  }

  function toggleSelection(
    currentValues: DocumentId[],
    setValues: (values: DocumentId[]) => void,
    value: DocumentId,
  ) {
    if (currentValues.includes(value)) {
      setValues(currentValues.filter((item) => item !== value));
      return;
    }
    setValues([...currentValues, value]);
  }

  function onUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;
    uploadMutation.mutate(
      {
        file: selectedFile,
        displayName: uploadDisplayName.trim() || undefined,
      },
      {
        onSuccess: (document) => {
          setSelectedFile(null);
          setUploadDisplayName("");
          navigate(`/projects/${typedProjectId}/documents/${document.id}`);
        },
      },
    );
  }

  function onDeleteDocument(documentId: DocumentId) {
    const confirmed = window.confirm("Delete this document?");
    if (!confirmed) return;
    deleteMutation.mutate(documentId);
  }

  function onRagSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitQuestion) return;
    ragMutation.mutate({
      question: question.trim(),
      targetDocumentIds,
    });
  }

  function onAnalysisSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitAnalysis) return;
    startAnalysisMutation.mutate(
      {
        baseDocumentId: baseDocumentId as DocumentId,
        targetDocumentIds: analysisTargets,
      },
      {
        onSuccess: (result) => {
          navigate(`/projects/${typedProjectId}/analysis/${result.job_id}`);
        },
      },
    );
  }

  return (
    <AppShell
      title={projectQuery.data?.name ?? "Project Workspace"}
      subtitle="Upload documents, watch indexing state, ask scoped RAG questions, and launch contradiction analysis jobs against indexed material."
    >
      <section className="hero-bar">
        <Link className="pill pill--ghost" to="/projects">
          Back to projects
        </Link>
        {projectQuery.data && (
          <>
            <span className="pill">#{projectQuery.data.id}</span>
            <span className="pill">{projectQuery.data.document_count} documents</span>
            <span className="pill">{indexedDocuments.length} indexed</span>
            <span className="pill">
              {processingDocuments.length > 0
                ? `${processingDocuments.length} still processing`
                : "Pipeline idle"}
            </span>
          </>
        )}
      </section>

      <section className="page-grid page-grid--two-up">
        <section className="panel panel--glow">
          {projectQuery.isLoading && <p className="muted">Loading project...</p>}
          {projectQuery.isError && (
            <p className="error">
              {readApiErrorMessage(projectQuery.error, "Failed to load project.")}
            </p>
          )}
          {projectQuery.data && (
            <>
              <div className="section-head">
                <div>
                  <span className="section-kicker">Workspace overview</span>
                  <h2>Project briefing</h2>
                </div>
              </div>
              <p>{projectQuery.data.description || "No description provided."}</p>
              <div className="metrics-grid metrics-grid--compact">
                <article className="metric-card">
                  <span className="metric-card__label">Indexed</span>
                  <strong>{indexedDocuments.length}</strong>
                </article>
                <article className="metric-card">
                  <span className="metric-card__label">Queued / processing</span>
                  <strong>{processingDocuments.length}</strong>
                </article>
                <article className="metric-card">
                  <span className="metric-card__label">Failed</span>
                  <strong>
                    {documents.filter((document) => document.status === "failed").length}
                  </strong>
                </article>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="section-kicker">Ingest</span>
              <h2>Upload document</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={onUpload}>
            <label>
              File
              <input
                type="file"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              Display name
              <input
                value={uploadDisplayName}
                onChange={(event) => setUploadDisplayName(event.target.value)}
                placeholder="Optional custom name"
                maxLength={255}
              />
            </label>
            <p className="muted">{uploadHint}</p>
            <button type="submit" disabled={!selectedFile || uploadMutation.isPending}>
              {uploadMutation.isPending ? "Uploading..." : "Upload to project"}
            </button>
          </form>
          {uploadMutation.isError && (
            <p className="error">
              {readApiErrorMessage(uploadMutation.error, "Failed to upload document.")}
            </p>
          )}
        </section>
      </section>

      <section className="panel panel--stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">Corpus</span>
            <h2>Documents</h2>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void documentsQuery.refetch()}
            disabled={documentsQuery.isFetching}
          >
            {documentsQuery.isFetching ? "Refreshing..." : "Refresh list"}
          </button>
        </div>
        {documentsQuery.isLoading && <p className="muted">Loading documents...</p>}
        {documentsQuery.isError && (
          <p className="error">
            {readApiErrorMessage(documentsQuery.error, "Failed to load documents.")}
          </p>
        )}
        {!documentsQuery.isLoading && !documentsQuery.isError && documents.length === 0 && (
          <div className="empty-state">
            <h3>No documents yet</h3>
            <p>Upload text, markdown, PDF, or DOCX material to start indexing.</p>
          </div>
        )}
        {documents.length > 0 && (
          <ul className="entity-list">
            {documents.map((document) => (
              <li key={document.id} className="entity-card">
                <div className="entity-card__header">
                  <div>
                    <h3>{document.name}</h3>
                    <p>{document.mime_type}</p>
                  </div>
                  {renderStatus(document.status)}
                </div>
                <div className="entity-meta entity-meta-wrap">
                  <span>#{document.id}</span>
                  <span>{Math.max(1, Math.round(document.size_bytes / 1024))} KB</span>
                  <span>Updated {new Date(document.updated_at).toLocaleString()}</span>
                </div>
                {document.status === "failed" && (
                  <p className="warning">
                    Processing failed. Open the document page to inspect the current state and
                    retry after backend fixes if needed.
                  </p>
                )}
                <div className="inline-actions">
                  <Link to={`/projects/${typedProjectId}/documents/${document.id}`}>
                    Open document
                  </Link>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => onDeleteDocument(document.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="page-grid page-grid--two-up">
        <section className="panel panel--glow">
          <div className="section-head">
            <div>
              <span className="section-kicker">Ask</span>
              <h2>RAG query</h2>
            </div>
            <span className="pill">{indexedDocuments.length} indexed candidates</span>
          </div>
          <form className="form-grid" onSubmit={onRagSubmit}>
            <label>
              Question
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What does the procurement standard require before onboarding a new vendor?"
                maxLength={10000}
              />
            </label>
            <fieldset className="picker">
              <legend>Target documents (optional, indexed only)</legend>
              {indexedDocuments.length === 0 && (
                <p className="muted">No indexed documents available yet.</p>
              )}
              {indexedDocuments.map((document) => (
                <label key={document.id} className="picker__item">
                  <input
                    type="checkbox"
                    checked={targetDocumentIds.includes(document.id)}
                    onChange={() =>
                      toggleSelection(targetDocumentIds, setTargetDocumentIds, document.id)
                    }
                  />
                  <span>{document.name}</span>
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              disabled={!canSubmitQuestion || ragMutation.isPending || indexedDocuments.length === 0}
            >
              {ragMutation.isPending ? "Running retrieval..." : "Ask the corpus"}
            </button>
          </form>
          {ragError && <p className="error">{ragError}</p>}
          {ragMutation.data && (
            <div className="result-card">
              <div className="result-card__header">
                <h3>Answer</h3>
                {ragMutation.data.warning_message && (
                  <span className="pill pill--warning">Warning present</span>
                )}
              </div>
              <p>{ragMutation.data.answer}</p>
              {ragMutation.data.warning_message && (
                <p className="warning">{ragMutation.data.warning_message}</p>
              )}
              <h4>Citations</h4>
              {ragMutation.data.citations.length === 0 && (
                <p className="muted">No citations returned.</p>
              )}
              <ul className="citation-list">
                {ragMutation.data.citations.map((citation) => (
                  <li key={`${citation.document_id}-${citation.snippet}`}>
                    <strong>{citation.document_name}</strong>
                    <p>{citation.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="section-kicker">Compare</span>
              <h2>Contradiction analysis</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={onAnalysisSubmit}>
            <label>
              Base document
              <select
                value={baseDocumentId}
                onChange={(event) => {
                  const value = event.target.value;
                  setBaseDocumentId(value ? Number(value) : "");
                }}
              >
                <option value="">Select indexed base document</option>
                {indexedDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="picker">
              <legend>Target documents (optional, indexed only)</legend>
              {indexedDocuments
                .filter((document) => document.id !== baseDocumentId)
                .map((document) => (
                  <label key={document.id} className="picker__item">
                    <input
                      type="checkbox"
                      checked={analysisTargets.includes(document.id)}
                      onChange={() =>
                        toggleSelection(analysisTargets, setAnalysisTargets, document.id)
                      }
                    />
                    <span>{document.name}</span>
                  </label>
                ))}
            </fieldset>
            <button
              type="submit"
              disabled={!canSubmitAnalysis || startAnalysisMutation.isPending || indexedDocuments.length === 0}
            >
              {startAnalysisMutation.isPending ? "Queueing analysis..." : "Start async analysis"}
            </button>
          </form>
          {analysisError && <p className="error">{analysisError}</p>}
          <p className="muted">
            The backend compares stored base-document chunk embeddings against nearest target
            chunks, then runs LLM contradiction judgement and document-level summarization.
          </p>
        </section>
      </section>
    </AppShell>
  );
}
