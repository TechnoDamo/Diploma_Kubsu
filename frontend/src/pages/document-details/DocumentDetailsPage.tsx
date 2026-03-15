import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useDocument,
  useDocumentContent,
  useDocumentText,
} from "../../features/documents/documents.queries";
import { readApiErrorMessage, isApiError } from "../../shared/api/errors";
import type { DocumentId, ProjectId } from "../../shared/types/api";
import { AppShell } from "../../shared/ui/AppShell";

export function DocumentDetailsPage() {
  const { projectId, documentId } = useParams();
  const typedProjectId = projectId as ProjectId | undefined;
  const typedDocumentId = documentId as DocumentId | undefined;

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const documentQuery = useDocument(typedProjectId, typedDocumentId);
  const documentTextQuery = useDocumentText(typedProjectId, typedDocumentId);
  const documentContentQuery = useDocumentContent(typedProjectId, typedDocumentId);

  const textPending = useMemo(() => {
    if (!documentTextQuery.isError) return false;
    return isApiError(documentTextQuery.error) && documentTextQuery.error.code === "DOCUMENT_NOT_READY";
  }, [documentTextQuery.error, documentTextQuery.isError]);

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
      title={documentQuery.data?.name ?? "Document"}
      subtitle="Metadata, processing status, extracted text, and original content access."
    >
      <section className="panel">
        <p>
          <Link to={`/projects/${typedProjectId}`}>Back to project</Link>
        </p>
        {documentQuery.isLoading && <p className="muted">Loading document...</p>}
        {documentQuery.isError && (
          <p className="error">
            {readApiErrorMessage(documentQuery.error, "Failed to load document metadata.")}
          </p>
        )}
        {documentQuery.data && (
          <>
            <h2>Metadata</h2>
            <div className="chips">
              <span>{documentQuery.data.status}</span>
              <span>{documentQuery.data.mime_type}</span>
              <span>{Math.round(documentQuery.data.size_bytes / 1024)} KB</span>
            </div>
            <p className="muted">ID: {documentQuery.data.id}</p>
            <button
              type="button"
              onClick={() => void documentQuery.refetch()}
              disabled={documentQuery.isFetching}
            >
              {documentQuery.isFetching ? "Refreshing..." : "Refresh status"}
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Extracted Text</h2>
        {documentTextQuery.isLoading && <p className="muted">Loading extracted text...</p>}
        {textPending && (
          <p className="muted">
            Extracted text is not ready yet. Keep this page open while processing continues.
          </p>
        )}
        {documentTextQuery.isError && !textPending && (
          <p className="error">
            {readApiErrorMessage(documentTextQuery.error, "Failed to load extracted text.")}
          </p>
        )}
        {documentTextQuery.data && (
          <pre className="text-block">{documentTextQuery.data.text}</pre>
        )}
        <button
          type="button"
          onClick={() => void documentTextQuery.refetch()}
          disabled={documentTextQuery.isFetching}
        >
          {documentTextQuery.isFetching ? "Checking..." : "Check text availability"}
        </button>
      </section>

      <section className="panel">
        <h2>Original Content</h2>
        <p className="muted">
          This uses `/content` and downloads the raw file as a browser object URL.
        </p>
        <button
          type="button"
          onClick={() => void documentContentQuery.refetch()}
          disabled={documentContentQuery.isFetching}
        >
          {documentContentQuery.isFetching ? "Preparing..." : "Load content"}
        </button>
        {documentContentQuery.isError && (
          <p className="error">
            {readApiErrorMessage(documentContentQuery.error, "Failed to load document content.")}
          </p>
        )}
        {downloadUrl && (
          <p>
            <a href={downloadUrl} download={documentQuery.data?.name || "document"}>
              Download file
            </a>
          </p>
        )}
      </section>
    </AppShell>
  );
}
