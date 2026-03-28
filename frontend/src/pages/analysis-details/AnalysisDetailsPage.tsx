import { Link, useParams } from "react-router-dom";
import { useAnalysisJob } from "../../features/analysis/analysis.queries";
import { readApiErrorMessage } from "../../shared/api/errors";
import { parseRouteId } from "../../shared/lib/ids";
import type { JobId, ProjectId } from "../../shared/types/api";
import { AppShell } from "../../shared/ui/AppShell";

export function AnalysisDetailsPage() {
  const { projectId, jobId } = useParams();
  const typedProjectId = parseRouteId(projectId) as ProjectId | undefined;
  const typedJobId = parseRouteId(jobId) as JobId | undefined;
  const jobQuery = useAnalysisJob(typedProjectId, typedJobId);

  if (!typedProjectId || !typedJobId) {
    return (
      <AppShell
        title="Invalid Analysis Route"
        subtitle="The requested analysis path is malformed."
      >
        <section className="panel">
          <p className="error">Project ID and job ID must both be positive integers.</p>
          <Link to="/projects">Return to projects</Link>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Contradiction Analysis"
      subtitle="Track the async comparison job, inspect target-level summaries, and drill into contradiction evidence."
    >
      <section className="hero-bar">
        <Link className="pill pill--ghost" to={`/projects/${typedProjectId}`}>
          Back to project
        </Link>
        <span className="pill">Job #{typedJobId}</span>
        {jobQuery.data && <span className="pill">{jobQuery.data.status}</span>}
      </section>

      <section className="panel panel--glow">
        <div className="section-head">
          <div>
            <span className="section-kicker">Async job</span>
            <h2>Execution status</h2>
          </div>
        </div>
        {jobQuery.isLoading && <p className="muted">Loading job...</p>}
        {jobQuery.isError && (
          <p className="error">
            {readApiErrorMessage(jobQuery.error, "Failed to load analysis job.")}
          </p>
        )}
        {jobQuery.data && (
          <>
            <div className="metrics-grid metrics-grid--compact">
              <article className="metric-card">
                <span className="metric-card__label">Job</span>
                <strong>{jobQuery.data.job_id}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-card__label">Status</span>
                <strong>{jobQuery.data.status}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-card__label">Targets with findings</span>
                <strong>{jobQuery.data.results?.length ?? 0}</strong>
              </article>
            </div>
            {jobQuery.data.warning_message && (
              <p className="warning">{jobQuery.data.warning_message}</p>
            )}
            {(jobQuery.data.status === "queued" ||
              jobQuery.data.status === "processing") && (
              <p className="muted">Polling every 2 seconds...</p>
            )}
            {jobQuery.data.status === "failed" && (
              <p className="error">
                {jobQuery.data.error_message || "Analysis failed without error details."}
              </p>
            )}
            {jobQuery.data.status === "completed" && (
              <>
                <div className="section-head section-head--tight">
                  <div>
                    <span className="section-kicker">Results</span>
                    <h3>Contradiction findings</h3>
                  </div>
                </div>
                {(!jobQuery.data.results || jobQuery.data.results.length === 0) && (
                  <p className="muted">No contradictions found.</p>
                )}
                {jobQuery.data.results && jobQuery.data.results.length > 0 && (
                  <ul className="entity-list">
                    {jobQuery.data.results.map((result) => (
                      <li key={result.target_document_id} className="entity-card">
                        <div className="entity-card__header">
                          <div>
                            <h4>{result.target_document_name}</h4>
                            <p>Target document #{result.target_document_id}</p>
                          </div>
                          <span className="pill">{result.contradictions.length} findings</span>
                        </div>
                        <div className="summary-block">
                          <span className="summary-block__label">Target summary</span>
                          <p>{result.summary}</p>
                        </div>
                        {result.contradictions.length === 0 && (
                          <p className="muted">No contradictions in this target document.</p>
                        )}
                        {result.contradictions.length > 0 && (
                          <ul className="evidence-list">
                            {result.contradictions.map((item, index) => (
                              <li key={`${result.target_document_id}-${index}`}>
                                <div className="evidence-list__meta">
                                  <span>Confidence {item.confidence.toFixed(2)}</span>
                                  <span>
                                    base {item.base_chunk_order} / target {item.target_chunk_order}
                                  </span>
                                </div>
                                <p>
                                  <strong>Base:</strong> {item.base_text}
                                </p>
                                <p>
                                  <strong>Target:</strong> {item.target_text}
                                </p>
                                <p>
                                  <strong>Why it conflicts:</strong> {item.explanation}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
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
              {jobQuery.isFetching ? "Refreshing..." : "Refresh now"}
            </button>
          </>
        )}
      </section>
    </AppShell>
  );
}
