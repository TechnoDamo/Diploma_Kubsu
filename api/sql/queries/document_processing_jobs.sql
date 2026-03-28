-- name: EnqueueDocumentProcessingJob :one
INSERT INTO documents.document_processing_jobs (
    project_id,
    document_id,
    project_index_config_id,
    job_type,
    status
) VALUES (
    $1,
    $2,
    $3,
    $4,
    'queued'
)
RETURNING *;

-- name: ClaimNextDocumentProcessingJob :one
WITH next_job AS (
    SELECT id
    FROM documents.document_processing_jobs
    WHERE status = 'queued'
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE documents.document_processing_jobs AS j
SET status = 'processing',
    started_at = CURRENT_TIMESTAMP,
    attempt_count = attempt_count + 1,
    error_message = NULL
FROM next_job
WHERE j.id = next_job.id
RETURNING j.*;

-- name: MarkDocumentProcessingJobCompleted :exec
UPDATE documents.document_processing_jobs
SET status = 'completed',
    completed_at = CURRENT_TIMESTAMP,
    error_message = NULL
WHERE id = $1;

-- name: MarkDocumentProcessingJobFailed :exec
UPDATE documents.document_processing_jobs
SET status = 'failed',
    completed_at = CURRENT_TIMESTAMP,
    error_message = $2
WHERE id = $1;
