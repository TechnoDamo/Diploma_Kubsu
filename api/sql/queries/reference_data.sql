-- name: GetEmbeddingModelByName :one
SELECT *
FROM embeddings.embedding_models
WHERE name = $1;

-- name: GetDocumentStatusByName :one
SELECT *
FROM documents.document_statuses
WHERE name = $1;
