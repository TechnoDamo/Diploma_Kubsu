-- name: GetActiveProjectIndexConfig :one
SELECT *
FROM documents.project_index_configs
WHERE project_id = $1
  AND status = 'active'
ORDER BY version DESC
LIMIT 1;

-- name: GetLatestProjectIndexConfig :one
SELECT *
FROM documents.project_index_configs
WHERE project_id = $1
ORDER BY version DESC
LIMIT 1;

-- name: CreateProjectIndexConfig :one
INSERT INTO documents.project_index_configs (
    project_id,
    ingestion_pipeline_id,
    embedding_pipeline_id,
    embedding_model_id,
    embedding_dimension,
    parser_name,
    parser_version,
    chunking_strategy,
    chunk_size,
    chunk_overlap,
    chunk_unit,
    tokenizer_name,
    status,
    version
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11,
    $12,
    $13,
    $14
)
RETURNING *;

-- name: SetProjectIndexConfigStatus :exec
UPDATE documents.project_index_configs
SET status = $2
WHERE id = $1;

-- name: MarkOtherProjectConfigsSuperseded :exec
UPDATE documents.project_index_configs
SET status = 'superseded'
WHERE project_id = $1
  AND id <> $2
  AND status = 'active';
