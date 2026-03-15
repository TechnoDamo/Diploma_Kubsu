import { Link, useParams } from "react-router-dom";
import { useAnalysisJob } from "../../features/analysis/analysis.queries";
import { readApiErrorMessage } from "../../shared/api/errors";
import type { JobId, ProjectId } from "../../shared/types/api";
import { AppShell } from "../../shared/ui/AppShell";

export function AnalysisDetailsPage() {
  const { projectId, jobId } = useParams();
  const typedProjectId = projectId as ProjectId | undefined;
  const typedJobId = jobId as JobId | undefined;
  const jobQuery = useAnalysisJob(typedProjectId, typedJobId);

  return (
    <AppShell
      title="Contradiction Analysis"
      subtitle="Track asynchronous analysis status and inspect contradiction findings."
    >
      <section className="panel">
        <p>
          <Link to={`/projects/${typedProjectId}`}>Back to project</Link>
        </p>
        {jobQuery.isLoading && <p className="muted">Loading job...</p>}
        {jobQuery.isError && (
          <p className="error">
            {readApiErrorMessage(jobQuery.error, "Failed to load analysis job.")}
          </p>
        )}
        {jobQuery.data && (
          <>
            <h2>Job {jobQuery.data.job_id}</h2>
            <p>
              Status: <span className="status">{jobQuery.data.status}</span>
            </p>
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
                <h3>Results</h3>
                {(!jobQuery.data.results || jobQuery.data.results.length === 0) && (
                  <p className="muted">No contradictions found.</p>
                )}
                {jobQuery.data.results && jobQuery.data.results.length > 0 && (
                  <ul className="entity-list">
                    {jobQuery.data.results.map((result) => (
                      <li key={result.target_document_id} className="entity-card">
                        <h4>Target: {result.target_document_id}</h4>
                        {result.contradictions.length === 0 && (
                          <p className="muted">No contradictions in this target document.</p>
                        )}
                        {result.contradictions.length > 0 && (
                          <ul>
                            {result.contradictions.map((item, index) => (
                              <li key={`${result.target_document_id}-${index}`}>
                                <strong>Base:</strong> {item.base_text}
                                <br />
                                <strong>Target:</strong> {item.target_text}
                                <br />
                                <strong>Confidence:</strong> {item.confidence.toFixed(2)}
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
