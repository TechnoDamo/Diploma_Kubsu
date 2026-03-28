-- name: EnqueueAnalysisJob :one
INSERT INTO analysis.analysis_jobs (
    project_id,
    base_document_id,
    project_index_config_id,
    status,
    requested_target_document_ids,
    warning_message
) VALUES (
    $1,
    $2,
    $3,
    'queued',
    $4,
    $5
)
RETURNING *;

-- name: AddAnalysisJobTarget :exec
INSERT INTO analysis.analysis_job_targets (
    analysis_job_id,
    document_id
) VALUES (
    $1,
    $2
)
ON CONFLICT (analysis_job_id, document_id) DO NOTHING;

-- name: ListAnalysisJobTargets :many
SELECT
    t.analysis_job_id,
    t.document_id,
    d.name AS document_name,
    t.created_at
FROM analysis.analysis_job_targets AS t
JOIN documents.documents AS d
    ON d.id = t.document_id
WHERE t.analysis_job_id = $1
ORDER BY t.document_id;

-- name: GetAnalysisJobByID :one
SELECT *
FROM analysis.analysis_jobs
WHERE project_id = $1
  AND id = $2;

-- name: ClaimNextAnalysisJob :one
WITH next_job AS (
    SELECT id
    FROM analysis.analysis_jobs
    WHERE status = 'queued'
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE analysis.analysis_jobs AS j
SET status = 'processing',
    started_at = CURRENT_TIMESTAMP,
    error_message = NULL
FROM next_job
WHERE j.id = next_job.id
RETURNING j.*;

-- name: MarkAnalysisJobCompleted :exec
UPDATE analysis.analysis_jobs
SET status = 'completed',
    completed_at = CURRENT_TIMESTAMP,
    result_payload = $2,
    error_message = NULL
WHERE id = $1;

-- name: MarkAnalysisJobFailed :exec
UPDATE analysis.analysis_jobs
SET status = 'failed',
    completed_at = CURRENT_TIMESTAMP,
    error_message = $2
WHERE id = $1;
