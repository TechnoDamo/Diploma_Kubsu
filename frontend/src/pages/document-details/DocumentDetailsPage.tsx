import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useDocument,
  useDocumentContent,
  useDocumentText,
} from "../../features/documents/documents.queries";
import { readApiErrorMessage, isApiError } from "../../shared/api/errors";
import { t } from "../../shared/i18n";
import { parseRouteId } from "../../shared/lib/ids";
import type { DocumentId, ProjectId } from "../../shared/types/api";
import { AppShell } from "../../shared/ui/AppShell";

function formatDocumentStatus(status: string) {
  return t.shared.statusDocument(status as never);
}

export function DocumentDetailsPage() {
  const { projectId, documentId } = useParams();
  const typedProjectId = parseRouteId(projectId) as ProjectId | undefined;
  const typedDocumentId = parseRouteId(documentId) as DocumentId | undefined;

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const documentQuery = useDocument(typedProjectId, typedDocumentId);
  const documentTextQuery = useDocumentText(typedProjectId, typedDocumentId);
  const documentContentQuery = useDocumentContent(typedProjectId, typedDocumentId);

  const textPending = useMemo(() => {
    if (!documentTextQuery.isError) return false;
    return (
      isApiError(documentTextQuery.error) && documentTextQuery.error.code === "DOCUMENT_NOT_READY"
    );
  }, [documentTextQuery.error, documentTextQuery.isError]);

  if (!typedProjectId || !typedDocumentId) {
    return (
      <AppShell
        title={t.documentDetails.invalid.title}
        subtitle={t.documentDetails.invalid.subtitle}
      >
        <section className="panel">
          <p className="error">{t.documentDetails.invalid.body}</p>
          <Link to="/projects">{t.shared.backToProjects}</Link>
        </section>
      </AppShell>
    );
  }

  useEffect(() => {
    if (documentQuery.data?.status === "indexed") {
      void documentTextQuery.refetch();
    }
    if (
      documentQuery.data?.status === "processing" ||
      documentQuery.data?.status === "uploaded"
    ) {
      const timer = window.setInterval(() => {
        void documentQuery.refetch();
      }, 2000);
      return () => window.clearInterval(timer);
    }
    return undefined;
  }, [documentQuery.data?.status, documentQuery.refetch, documentTextQuery.refetch]);

  useEffect(() => {
    if (!documentContentQuery.data) return;
    const objectUrl = URL.createObjectURL(documentContentQuery.data);
    setDownloadUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setDownloadUrl(null);
    };
  }, [documentContentQuery.data]);

  return (
    <AppShell
      title={documentQuery.data?.name ?? t.documentDetails.titleFallback}
      subtitle={t.documentDetails.subtitle}
    >
      <section className="hero-bar">
        <Link className="pill pill--ghost" to={`/projects/${typedProjectId}`}>
          {t.shared.backToProject}
        </Link>
        {documentQuery.data && (
          <>
            <span className="pill">#{documentQuery.data.id}</span>
            <span className="pill">{documentQuery.data.mime_type}</span>
            <span className="pill">{formatDocumentStatus(documentQuery.data.status)}</span>
          </>
        )}
      </section>

      <section className="page-grid page-grid--two-up">
        <section className="panel panel--glow">
          <div className="section-head">
            <div>
              <span className="section-kicker">{t.documentDetails.metadata.kicker}</span>
              <h2>{t.documentDetails.metadata.title}</h2>
            </div>
          </div>
          {documentQuery.isLoading && <p className="muted">{t.documentDetails.metadata.loading}</p>}
        {documentQuery.isError && (
          <p className="error">
            {readApiErrorMessage(
              documentQuery.error,
              t.documentDetails.errors.metadata,
            )}
          </p>
        )}
        {documentQuery.data && (
          <>
            <div className="chips">
              <span>{formatDocumentStatus(documentQuery.data.status)}</span>
              <span>{documentQuery.data.mime_type}</span>
              <span>{Math.round(documentQuery.data.size_bytes / 1024)} KB</span>
            </div>
            <p className="muted">{t.documentDetails.metadata.id(documentQuery.data.id)}</p>
            <p className="muted">{t.documentDetails.metadata.updated(documentQuery.data.updated_at)}</p>
            {documentQuery.data.status === "failed" && (
              <p className="warning">{t.documentDetails.metadata.failedWarning}</p>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void documentQuery.refetch()}
              disabled={documentQuery.isFetching}
            >
              {documentQuery.isFetching
                ? t.documentDetails.metadata.refreshing
                : t.documentDetails.metadata.refresh}
            </button>
          </>
        )}
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="section-kicker">{t.documentDetails.text.kicker}</span>
              <h2>{t.documentDetails.text.title}</h2>
            </div>
          </div>
          {documentTextQuery.isLoading && (
            <p className="muted">{t.documentDetails.text.loading}</p>
          )}
        {textPending && (
          <p className="muted">{t.documentDetails.text.pending}</p>
        )}
        {documentTextQuery.isError && !textPending && (
          <p className="error">
            {readApiErrorMessage(
              documentTextQuery.error,
              t.documentDetails.errors.text,
            )}
          </p>
        )}
        {documentTextQuery.data && (
          <pre className="text-block">{documentTextQuery.data.text}</pre>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void documentTextQuery.refetch()}
          disabled={documentTextQuery.isFetching}
        >
          {documentTextQuery.isFetching
            ? t.documentDetails.text.checking
            : t.documentDetails.text.check}
        </button>
        </section>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="section-kicker">{t.documentDetails.content.kicker}</span>
            <h2>{t.documentDetails.content.title}</h2>
          </div>
        </div>
        <p className="muted">{t.documentDetails.content.body}</p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void documentContentQuery.refetch()}
          disabled={documentContentQuery.isFetching}
        >
          {documentContentQuery.isFetching
            ? t.documentDetails.content.loading
            : t.documentDetails.content.load}
        </button>
        {documentContentQuery.isError && (
          <p className="error">
            {readApiErrorMessage(
              documentContentQuery.error,
              t.documentDetails.errors.content,
            )}
          </p>
        )}
        {downloadUrl && (
          <p>
            <a
              className="text-link"
              href={downloadUrl}
              download={documentQuery.data?.name || "document"}
            >
              {t.documentDetails.content.download}
            </a>
          </p>
        )}
      </section>
    </AppShell>
  );
}
