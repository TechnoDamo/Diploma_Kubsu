import { Link, useParams } from "react-router-dom";
import { useAnalysisJob } from "../../features/analysis/analysis.queries";
import { readApiErrorMessage } from "../../shared/api/errors";
import { t } from "../../shared/i18n";
import { parseRouteId } from "../../shared/lib/ids";
import type { JobId, ProjectId } from "../../shared/types/api";
import { AppShell } from "../../shared/ui/AppShell";
import { MarkdownContent } from "../../shared/ui/MarkdownContent";

function buildContradictionPreview(baseText: string, targetText: string) {
  const preview = `${baseText} / ${targetText}`
    .replace(/\s+/g, " ")
    .trim();

  if (preview.length === 0) {
    return t.analysisDetails.job.contradictionPreviewFallback;
  }
  if (preview.length <= 160) {
    return preview;
  }
  return `${preview.slice(0, 157).trimEnd()}...`;
}

function formatAnalysisStatus(status: string) {
  return t.shared.statusAnalysis(status as never);
}

export function AnalysisDetailsPage() {
  const { projectId, jobId } = useParams();
  const typedProjectId = parseRouteId(projectId) as ProjectId | undefined;
  const typedJobId = parseRouteId(jobId) as JobId | undefined;
  const jobQuery = useAnalysisJob(typedProjectId, typedJobId);

  if (!typedProjectId || !typedJobId) {
    return (
      <AppShell
        title={t.analysisDetails.invalid.title}
        subtitle={t.analysisDetails.invalid.subtitle}
      >
        <section className="panel">
          <p className="error">{t.analysisDetails.invalid.body}</p>
          <Link to="/projects">{t.shared.backToProjects}</Link>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={t.analysisDetails.title}
      subtitle={t.analysisDetails.subtitle}
    >
      <section className="hero-bar">
        <Link className="pill pill--ghost" to={`/projects/${typedProjectId}`}>
          {t.shared.backToProject}
        </Link>
        <span className="pill">{t.analysisDetails.hero.job(typedJobId)}</span>
        {jobQuery.data && (
          <span className="pill">{formatAnalysisStatus(jobQuery.data.status)}</span>
        )}
      </section>

      <section className="panel panel--glow">
        <div className="section-head">
          <div>
            <span className="section-kicker">{t.analysisDetails.job.kicker}</span>
            <h2>{t.analysisDetails.job.title}</h2>
          </div>
        </div>
        {jobQuery.isLoading && <p className="muted">{t.analysisDetails.job.loading}</p>}
        {jobQuery.isError && (
          <p className="error">
            {readApiErrorMessage(jobQuery.error, t.analysisDetails.job.loadError)}
          </p>
        )}
        {jobQuery.data && (
          <>
            <div className="metrics-grid metrics-grid--compact">
              <article className="metric-card">
                <span className="metric-card__label">{t.analysisDetails.job.idLabel}</span>
                <strong>{jobQuery.data.job_id}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-card__label">{t.analysisDetails.job.statusLabel}</span>
                <strong>{formatAnalysisStatus(jobQuery.data.status)}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-card__label">{t.analysisDetails.job.findingsLabel}</span>
                <strong>{jobQuery.data.results?.length ?? 0}</strong>
              </article>
            </div>
            {jobQuery.data.warning_message && (
              <p className="warning">{jobQuery.data.warning_message}</p>
            )}
            {(jobQuery.data.status === "queued" ||
              jobQuery.data.status === "processing") && (
              <p className="muted">{t.analysisDetails.job.polling}</p>
            )}
            {jobQuery.data.status === "failed" && (
              <p className="error">
                {jobQuery.data.error_message || t.analysisDetails.job.failedFallback}
              </p>
            )}
            {jobQuery.data.status === "completed" && (
              <>
                <div className="section-head section-head--tight">
                  <div>
                    <span className="section-kicker">{t.analysisDetails.job.resultsKicker}</span>
                    <h3>{t.analysisDetails.job.resultsTitle}</h3>
                  </div>
                </div>
                {(!jobQuery.data.results || jobQuery.data.results.length === 0) && (
                  <p className="muted">{t.analysisDetails.job.empty}</p>
                )}
                {jobQuery.data.results && jobQuery.data.results.length > 0 && (
                  <ul className="entity-list">
                    {jobQuery.data.results.map((result, resultIndex) => (
                      <li key={result.target_document_id} className="entity-card">
                        <details className="analysis-card" open={resultIndex === 0}>
                          <summary className="analysis-card__summary">
                            <div className="analysis-card__title">
                              <div>
                                <h4>{result.target_document_name}</h4>
                                <p>{t.analysisDetails.job.targetDocument(result.target_document_id)}</p>
                              </div>
                              <span className="pill">
                                {t.shared.counts.findings(result.contradictions.length)}
                              </span>
                            </div>
                            <p className="analysis-card__preview">{result.summary}</p>
                          </summary>
                          <div className="analysis-card__body">
                            <div className="summary-block">
                              <span className="summary-block__label">{t.analysisDetails.job.summaryLabel}</span>
                              <MarkdownContent content={result.summary} />
                            </div>
                            {result.contradictions.length === 0 && (
                              <p className="muted">{t.analysisDetails.job.noTargetContradictions}</p>
                            )}
                            {result.contradictions.length > 0 && (
                              <ul className="evidence-list">
                                {result.contradictions.map((item, index) => (
                                  <li key={`${result.target_document_id}-${index}`}>
                                    <details className="evidence-card">
                                      <summary className="evidence-card__summary">
                                        <div className="evidence-list__meta">
                                          <span>{t.analysisDetails.job.confidence(item.confidence)}</span>
                                          <span>{t.analysisDetails.job.chunkPair(item.base_chunk_order, item.target_chunk_order)}</span>
                                        </div>
                                        <p className="evidence-card__preview">
                                          {buildContradictionPreview(item.base_text, item.target_text)}
                                        </p>
                                      </summary>
                                      <div className="evidence-card__body">
                                        <p>
                                          <strong>{t.analysisDetails.job.base}</strong> {item.base_text}
                                        </p>
                                        <p>
                                          <strong>{t.analysisDetails.job.target}</strong> {item.target_text}
                                        </p>
                                        <div>
                                          <strong>{t.analysisDetails.job.explanation}</strong>
                                          <MarkdownContent content={item.explanation} />
                                        </div>
                                      </div>
                                    </details>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void jobQuery.refetch()}
              disabled={jobQuery.isFetching}
            >
              {jobQuery.isFetching ? t.shared.refreshing : t.shared.refresh}
            </button>
          </>
        )}
      </section>
    </AppShell>
  );
}
