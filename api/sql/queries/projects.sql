-- name: ListProjects :many
SELECT
    p.id,
    p.name,
    p.description,
    p.context,
    p.query_rewrite_enabled,
    p.retrieval_top_k,
    p.context_top_n,
    p.created_at,
    p.updated_at,
    COUNT(d.id)::BIGINT AS document_count
FROM documents.projects AS p
LEFT JOIN documents.documents AS d
    ON d.project_id = p.id
GROUP BY p.id
ORDER BY p.id DESC
LIMIT $1 OFFSET $2;

-- name: CountProjects :one
SELECT COUNT(*)::BIGINT
FROM documents.projects;

-- name: CreateProject :one
INSERT INTO documents.projects (
    name,
    description,
    context,
    query_rewrite_enabled,
    retrieval_top_k,
    context_top_n
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6
)
RETURNING *;

-- name: GetProjectByID :one
SELECT
    p.id,
    p.name,
    p.description,
    p.context,
    p.query_rewrite_enabled,
    p.retrieval_top_k,
    p.context_top_n,
    p.created_at,
    p.updated_at,
    COUNT(d.id)::BIGINT AS document_count
FROM documents.projects AS p
LEFT JOIN documents.documents AS d
    ON d.project_id = p.id
WHERE p.id = $1
GROUP BY p.id;

-- name: DeleteProjectByID :execrows
DELETE FROM documents.projects
WHERE id = $1;

-- name: CountActiveDocumentJobsForProject :one
SELECT COUNT(*)::BIGINT
FROM documents.document_processing_jobs
WHERE project_id = $1
  AND status IN ('queued', 'processing');

-- name: CountActiveAnalysisJobsForProject :one
SELECT COUNT(*)::BIGINT
FROM analysis.analysis_jobs
WHERE project_id = $1
  AND status IN ('queued', 'processing');

-- name: CountReindexingConfigsForProject :one
SELECT COUNT(*)::BIGINT
FROM documents.project_index_configs
WHERE project_id = $1
  AND status = 'reindexing';
