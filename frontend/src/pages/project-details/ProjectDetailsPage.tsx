import { useMemo, useState } from "react";
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
  const typedProjectId = projectId as ProjectId | undefined;

  const [uploadDisplayName, setUploadDisplayName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [targetDocumentIds, setTargetDocumentIds] = useState<DocumentId[]>([]);
  const [baseDocumentId, setBaseDocumentId] = useState<DocumentId | "">("");
  const [analysisTargets, setAnalysisTargets] = useState<DocumentId[]>([]);

  const projectQuery = useProject(projectId);
  const documentsQuery = useDocuments(typedProjectId);
  const uploadMutation = useUploadDocument(typedProjectId);
  const deleteMutation = useDeleteDocument(typedProjectId);
  const ragMutation = useRagQuery(typedProjectId);
  const startAnalysisMutation = useStartAnalysis(typedProjectId);

  const documents = documentsQuery.data?.items ?? [];

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
    () => typeof baseDocumentId === "string" && baseDocumentId.length > 0,
    [baseDocumentId],
  );

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
      title={projectQuery.data?.name ?? "Project"}
      subtitle="Manage project documents, run scoped RAG queries, and start contradiction analysis jobs."
    >
      <section className="panel">
        {projectQuery.isLoading && <p className="muted">Loading project...</p>}
        {projectQuery.isError && (
          <p className="error">
            {readApiErrorMessage(projectQuery.error, "Failed to load project.")}
          </p>
        )}
        {projectQuery.data && (
          <>
            <h2>Overview</h2>
            <p>{projectQuery.data.description || "No description provided."}</p>
            <div className="chips">
              <span>{projectQuery.data.document_count} documents</span>
              <span>{projectQuery.data.id}</span>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Upload Document</h2>
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
          <button type="submit" disabled={!selectedFile || uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </button>
        </form>
        {uploadMutation.isError && (
          <p className="error">
            {readApiErrorMessage(uploadMutation.error, "Failed to upload document.")}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Documents</h2>
        {documentsQuery.isLoading && <p className="muted">Loading documents...</p>}
        {documentsQuery.isError && (
          <p className="error">
            {readApiErrorMessage(documentsQuery.error, "Failed to load documents.")}
          </p>
        )}
        {!documentsQuery.isLoading && !documentsQuery.isError && documents.length === 0 && (
          <p className="muted">No documents yet.</p>
        )}
        {documents.length > 0 && (
          <ul className="entity-list">
            {documents.map((document) => (
              <li key={document.id} className="entity-card">
                <div>
                  <h3>{document.name}</h3>
                  <p>{document.mime_type}</p>
                </div>
                <div className="entity-meta entity-meta-wrap">
                  {renderStatus(document.status)}
                  <div className="inline-actions">
                    <Link to={`/projects/${typedProjectId}/documents/${document.id}`}>Open</Link>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => onDeleteDocument(document.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>RAG Query</h2>
        <form className="form-grid" onSubmit={onRagSubmit}>
          <label>
            Question
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What are the payment terms across uploaded contracts?"
              maxLength={10000}
            />
          </label>
          <fieldset className="picker">
            <legend>Target documents (optional)</legend>
            {documents.map((document) => (
              <label key={document.id} className="picker__item">
                <input
                  type="checkbox"
                  checked={targetDocumentIds.includes(document.id)}
                  onChange={() =>
                    toggleSelection(targetDocumentIds, setTargetDocumentIds, document.id)
                  }
                />
                {document.name}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={!canSubmitQuestion || ragMutation.isPending}>
            {ragMutation.isPending ? "Querying..." : "Ask"}
          </button>
        </form>
        {ragError && <p className="error">{ragError}</p>}
        {ragMutation.data && (
          <div className="result-card">
            <h3>Answer</h3>
            <p>{ragMutation.data.answer}</p>
            <h4>Citations</h4>
            {ragMutation.data.citations.length === 0 && (
              <p className="muted">No citations returned.</p>
            )}
            <ul>
              {ragMutation.data.citations.map((citation) => (
                <li key={`${citation.document_id}-${citation.snippet}`}>
                  <strong>{citation.document_name}</strong>: {citation.snippet}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Contradiction Analysis</h2>
        <form className="form-grid" onSubmit={onAnalysisSubmit}>
          <label>
            Base document
            <select
              value={baseDocumentId}
              onChange={(event) => setBaseDocumentId(event.target.value as DocumentId)}
            >
              <option value="">Select base document</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="picker">
            <legend>Target documents (optional)</legend>
            {documents.map((document) => (
              <label key={document.id} className="picker__item">
                <input
                  type="checkbox"
                  checked={analysisTargets.includes(document.id)}
                  onChange={() =>
                    toggleSelection(analysisTargets, setAnalysisTargets, document.id)
                  }
                />
                {document.name}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={!canSubmitAnalysis || startAnalysisMutation.isPending}>
            {startAnalysisMutation.isPending ? "Submitting..." : "Start analysis"}
          </button>
        </form>
        {analysisError && <p className="error">{analysisError}</p>}
      </section>
    </AppShell>
  );
}
