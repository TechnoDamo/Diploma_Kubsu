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
import { env } from "../../shared/config/env";
import { readApiErrorMessage } from "../../shared/api/errors";
import { t } from "../../shared/i18n";
import { parseRouteId } from "../../shared/lib/ids";
import type { Document, DocumentId, ProjectId } from "../../shared/types/api";
import { AppShell } from "../../shared/ui/AppShell";
import { MarkdownContent } from "../../shared/ui/MarkdownContent";

function buildCitationPreview(snippet: string) {
  const normalized = snippet
    .replace(/[`*_>#-]/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0) {
    return t.projectDetails.rag.citationPreviewFallback;
  }

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117).trimEnd()}...`;
}

function renderStatus(status: Document["status"]) {
  if (status === "indexed") {
    return <span className="status status-ok">{t.shared.statusDocument(status)}</span>;
  }
  if (status === "failed") {
    return <span className="status status-bad">{t.shared.statusDocument(status)}</span>;
  }
  if (status === "processing") {
    return <span className="status status-warn">{t.shared.statusDocument(status)}</span>;
  }
  return <span className="status">{t.shared.statusDocument(status)}</span>;
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
    ? readApiErrorMessage(ragMutation.error, t.projectDetails.errors.rag)
    : null;
  const analysisError = startAnalysisMutation.isError
    ? readApiErrorMessage(startAnalysisMutation.error, t.projectDetails.errors.analysis)
    : null;

  const canSubmitQuestion = useMemo(() => question.trim().length > 0, [question]);
  const canSubmitAnalysis = useMemo(
    () => typeof baseDocumentId === "number",
    [baseDocumentId],
  );
  const uploadMaxSizeMiB = useMemo(
    () => (env.uploadMaxSizeBytes / (1024 * 1024)).toFixed(0),
    [],
  );
  const uploadHint = t.projectDetails.upload.hint(uploadMaxSizeMiB);

  if (!typedProjectId) {
    return (
      <AppShell
        title={t.projectDetails.invalid.title}
        subtitle={t.projectDetails.invalid.subtitle}
      >
        <section className="panel">
          <p className="error">{t.projectDetails.invalid.body}</p>
          <Link to="/projects">{t.shared.backToProjects}</Link>
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
    const confirmed = window.confirm(t.projectDetails.documents.deleteConfirm);
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
      title={projectQuery.data?.name ?? t.projectDetails.titleFallback}
      subtitle={t.projectDetails.subtitle}
    >
      <section className="hero-bar">
        <Link className="pill pill--ghost" to="/projects">
          {t.shared.backToProjects}
        </Link>
        {projectQuery.data && (
          <>
            <span className="pill">#{projectQuery.data.id}</span>
            <span className="pill">
              {t.projectDetails.hero.documentCount(projectQuery.data.document_count)}
            </span>
            <span className="pill">{t.projectDetails.hero.indexedCount(indexedDocuments.length)}</span>
            <span className="pill">
              {processingDocuments.length > 0
                ? t.projectDetails.hero.processingCount(processingDocuments.length)
                : t.projectDetails.hero.idle}
            </span>
          </>
        )}
      </section>

      <section className="page-grid page-grid--two-up">
        <section className="panel panel--glow">
          {projectQuery.isLoading && <p className="muted">{t.projectDetails.overview.loading}</p>}
          {projectQuery.isError && (
            <p className="error">
              {readApiErrorMessage(projectQuery.error, t.projectDetails.errors.loadProject)}
            </p>
          )}
          {projectQuery.data && (
            <>
              <div className="section-head">
                <div>
                  <span className="section-kicker">{t.projectDetails.overview.kicker}</span>
                  <h2>{t.projectDetails.overview.title}</h2>
                </div>
              </div>
              {projectQuery.data.description ? (
                <MarkdownContent content={projectQuery.data.description} />
              ) : (
                <p>{t.projectDetails.overview.noDescription}</p>
              )}
              <div className="metrics-grid metrics-grid--compact">
                <article className="metric-card">
                  <span className="metric-card__label">{t.projectDetails.overview.indexed}</span>
                  <strong>{indexedDocuments.length}</strong>
                </article>
                <article className="metric-card">
                  <span className="metric-card__label">{t.projectDetails.overview.queued}</span>
                  <strong>{processingDocuments.length}</strong>
                </article>
                <article className="metric-card">
                  <span className="metric-card__label">{t.projectDetails.overview.failed}</span>
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
              <span className="section-kicker">{t.projectDetails.upload.kicker}</span>
              <h2>{t.projectDetails.upload.title}</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={onUpload}>
            <label>
              {t.projectDetails.upload.file}
              <input
                type="file"
                accept=".txt,.md,.html,.htm,.pdf,.docx,text/plain,text/markdown,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              {t.projectDetails.upload.displayName}
              <input
                value={uploadDisplayName}
                onChange={(event) => setUploadDisplayName(event.target.value)}
                placeholder={t.projectDetails.upload.displayNamePlaceholder}
                maxLength={255}
              />
            </label>
            <p className="muted">{uploadHint}</p>
            <button type="submit" disabled={!selectedFile || uploadMutation.isPending}>
              {uploadMutation.isPending
                ? t.projectDetails.upload.loading
                : t.projectDetails.upload.submit}
            </button>
          </form>
          {uploadMutation.isError && (
            <p className="error">
              {readApiErrorMessage(uploadMutation.error, t.projectDetails.errors.upload)}
            </p>
          )}
        </section>
      </section>

      <section className="panel panel--stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">{t.projectDetails.documents.kicker}</span>
            <h2>{t.projectDetails.documents.title}</h2>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void documentsQuery.refetch()}
            disabled={documentsQuery.isFetching}
          >
            {documentsQuery.isFetching
              ? t.projectDetails.documents.refreshing
              : t.projectDetails.documents.refresh}
          </button>
        </div>
        {documentsQuery.isLoading && <p className="muted">{t.projectDetails.documents.loading}</p>}
        {documentsQuery.isError && (
          <p className="error">
            {readApiErrorMessage(documentsQuery.error, t.projectDetails.errors.loadDocuments)}
          </p>
        )}
        {!documentsQuery.isLoading && !documentsQuery.isError && documents.length === 0 && (
          <div className="empty-state">
            <h3>{t.projectDetails.documents.emptyTitle}</h3>
            <p>{t.projectDetails.documents.emptyBody}</p>
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
                  <span>{t.shared.updatedAt(document.updated_at)}</span>
                </div>
                {document.status === "failed" && (
                  <p className="warning">{t.projectDetails.documents.failedWarning}</p>
                )}
                <div className="inline-actions">
                  <Link to={`/projects/${typedProjectId}/documents/${document.id}`}>
                    {t.shared.openDocument}
                  </Link>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => onDeleteDocument(document.id)}
                  >
                    {t.shared.delete}
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
              <span className="section-kicker">{t.projectDetails.rag.kicker}</span>
              <h2>{t.projectDetails.rag.title}</h2>
            </div>
            <span className="pill">{t.projectDetails.rag.candidateCount(indexedDocuments.length)}</span>
          </div>
          <form className="form-grid" onSubmit={onRagSubmit}>
            <label>
              {t.projectDetails.rag.question}
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={t.projectDetails.rag.questionPlaceholder}
                maxLength={10000}
              />
            </label>
            <fieldset className="picker">
              <legend>{t.projectDetails.rag.targetLegend}</legend>
              {indexedDocuments.length === 0 && (
                <p className="muted">{t.projectDetails.rag.noIndexed}</p>
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
              {ragMutation.isPending ? t.projectDetails.rag.loading : t.projectDetails.rag.submit}
            </button>
          </form>
          {ragError && <p className="error">{ragError}</p>}
          {ragMutation.data && (
            <div className="result-card">
              <div className="result-card__header">
                <h3>{t.projectDetails.rag.answer}</h3>
                {ragMutation.data.warning_message && (
                  <span className="pill pill--warning">{t.projectDetails.rag.warningPresent}</span>
                )}
              </div>
              <MarkdownContent content={ragMutation.data.answer} />
              {ragMutation.data.warning_message && (
                <p className="warning">{ragMutation.data.warning_message}</p>
              )}
              <div className="result-card__subhead">
                <h4>{t.projectDetails.rag.citations}</h4>
                <span className="pill">{t.projectDetails.rag.citationCount(ragMutation.data.citations.length)}</span>
              </div>
              {ragMutation.data.citations.length === 0 && (
                <p className="muted">{t.projectDetails.rag.noCitations}</p>
              )}
              <ul className="citation-list">
                {ragMutation.data.citations.map((citation, index) => (
                  <li key={`${citation.document_id}-${citation.snippet}`}>
                    <details className="citation-card" open={index === 0}>
                      <summary className="citation-card__summary">
                        <div className="citation-card__title">
                          <strong>{citation.document_name}</strong>
                          <span className="citation-card__meta">
                            {t.projectDetails.rag.citationDocument(citation.document_id)}
                          </span>
                        </div>
                        <p className="citation-card__preview">{buildCitationPreview(citation.snippet)}</p>
                      </summary>
                      <div className="citation-card__body">
                        <div className="citation-card__section">
                          <span className="summary-block__label">
                            {t.projectDetails.rag.citationAnswerLabel}
                          </span>
                          <MarkdownContent content={citation.snippet} />
                        </div>
                        <div className="citation-card__section">
                          <span className="summary-block__label">
                            {t.projectDetails.rag.citationSourceLabel}
                          </span>
                          <Link
                            className="text-link citation-card__source-link"
                            to={`/projects/${typedProjectId}/documents/${citation.document_id}`}
                          >
                            {citation.document_name}
                          </Link>
                          <p className="citation-card__meta-line">
                            {t.projectDetails.rag.citationDocument(citation.document_id)}
                          </p>
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="section-kicker">{t.projectDetails.analysis.kicker}</span>
              <h2>{t.projectDetails.analysis.title}</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={onAnalysisSubmit}>
            <label>
              {t.projectDetails.analysis.baseDocument}
              <select
                value={baseDocumentId}
                onChange={(event) => {
                  const value = event.target.value;
                  setBaseDocumentId(value ? Number(value) : "");
                }}
              >
                <option value="">{t.projectDetails.analysis.basePlaceholder}</option>
                {indexedDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="picker">
              <legend>{t.projectDetails.analysis.targetLegend}</legend>
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
              {startAnalysisMutation.isPending
                ? t.projectDetails.analysis.loading
                : t.projectDetails.analysis.submit}
            </button>
          </form>
          {analysisError && <p className="error">{analysisError}</p>}
          <p className="muted">{t.projectDetails.analysis.help}</p>
        </section>
      </section>
    </AppShell>
  );
}
