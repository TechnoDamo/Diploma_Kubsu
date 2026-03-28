-- name: ListDocumentsByProject :many
SELECT
    d.id,
    d.project_id,
    d.name,
    d.description,
    d.file_size_bytes,
    d.mime_type,
    s.name AS status,
    d.created_at,
    d.updated_at
FROM documents.documents AS d
JOIN documents.document_statuses AS s
    ON s.id = d.document_status_id
WHERE d.project_id = $1
ORDER BY d.id DESC
LIMIT $2 OFFSET $3;

-- name: CountDocumentsByProject :one
SELECT COUNT(*)::BIGINT
FROM documents.documents
WHERE project_id = $1;

-- name: CreateDocument :one
INSERT INTO documents.documents (
    project_id,
    project_index_config_id,
    document_status_id,
    ingestion_pipeline_id,
    embedding_pipeline_id,
    embedding_model_id,
    embedding_dimension,
    index_version,
    name,
    description,
    file_address,
    file_size_bytes,
    mime_type,
    checksum,
    language,
    parser_name,
    parser_version,
    chunking_strategy,
    chunk_size,
    chunk_overlap,
    chunk_unit,
    tokenizer_name,
    total_chunks,
    total_token_count
) VALUES (
    $1,
    $2,
    (SELECT id FROM documents.document_statuses WHERE name = $3),
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
    $14,
    $15,
    $16,
    $17,
    $18,
    $19,
    $20,
    $21,
    $22,
    $23,
    $24
)
RETURNING *;

-- name: GetDocumentByID :one
SELECT
    d.*,
    s.name AS status
FROM documents.documents AS d
JOIN documents.document_statuses AS s
    ON s.id = d.document_status_id
WHERE d.project_id = $1
  AND d.id = $2;

-- name: DeleteDocumentByID :execrows
DELETE FROM documents.documents
WHERE project_id = $1
  AND id = $2;

-- name: SetDocumentStatusByName :exec
UPDATE documents.documents AS d
SET document_status_id = s.id
FROM documents.document_statuses AS s
WHERE d.id = $1
  AND s.name = $2;

-- name: UpdateDocumentProcessingOutcome :exec
UPDATE documents.documents
SET language = $2,
    total_chunks = $3,
    total_token_count = $4
WHERE id = $1;

-- name: ListDocumentChunksForText :many
SELECT
    id,
    document_id,
    chunk_order_id,
    chunk_text,
    char_start,
    char_end,
    char_count,
    token_count,
    created_at
FROM documents.document_chunks
WHERE document_id = $1
ORDER BY chunk_order_id;

-- name: ListIndexedDocumentsForProject :many
SELECT
    d.id,
    d.name
FROM documents.documents AS d
JOIN documents.document_statuses AS s
    ON s.id = d.document_status_id
WHERE d.project_id = $1
  AND s.name = 'indexed'
ORDER BY d.id;

-- name: ListIndexedDocumentsByIDs :many
SELECT
    d.id,
    d.name
FROM documents.documents AS d
JOIN documents.document_statuses AS s
    ON s.id = d.document_status_id
WHERE d.project_id = $1
  AND d.id = ANY($2::BIGINT[])
  AND s.name = 'indexed'
ORDER BY d.id;

-- name: ListKnownDocumentsByIDs :many
SELECT
    d.id,
    s.name AS status
FROM documents.documents AS d
JOIN documents.document_statuses AS s
    ON s.id = d.document_status_id
WHERE d.project_id = $1
  AND d.id = ANY($2::BIGINT[])
ORDER BY d.id;

-- name: IsDocumentIndexed :one
SELECT EXISTS (
    SELECT 1
    FROM documents.documents AS d
    JOIN documents.document_statuses AS s
        ON s.id = d.document_status_id
    WHERE d.project_id = $1
      AND d.id = $2
      AND s.name = 'indexed'
);

-- name: CountActiveDocumentJobsForDocument :one
SELECT COUNT(*)::BIGINT
FROM documents.document_processing_jobs
WHERE document_id = $1
  AND status IN ('queued', 'processing');

-- name: CountActiveAnalysisJobsReferencingDocument :one
SELECT COUNT(DISTINCT j.id)::BIGINT
FROM analysis.analysis_jobs AS j
LEFT JOIN analysis.analysis_job_targets AS t
    ON t.analysis_job_id = j.id
WHERE j.status IN ('queued', 'processing')
  AND (j.base_document_id = $1 OR t.document_id = $1);
