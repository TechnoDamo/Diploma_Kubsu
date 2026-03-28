-- +goose Up
-- Seed embedding models
INSERT INTO embeddings.embedding_models (name, parameter_count, description)
VALUES
    (
        'all-MiniLM-L6-v2',
        0, -- OpenAI models don't have parameter count in the same way, using 0 as placeholder
        'sentence-transformers embedding model (very small)'
    ),
    (
        'Qwen3-Embedding-0.6B',
        600000000, -- 0.6 billion parameters
        'Qwen3 embedding model with 0.6B parameters'
    ),
    (
        'Qwen3-Embedding-8B',
        8000000000, -- 8 billion parameters
        'Qwen3 embedding model with 8B parameters'
    )
ON CONFLICT (name) DO UPDATE
SET
    parameter_count = EXCLUDED.parameter_count,
    description = EXCLUDED.description;

-- Seed test ingestion pipeline
INSERT INTO documents.ingestion_pipelines (id, name, description)
VALUES
    (
        1,
        'test',
        'Test ingestion pipeline for development'
    )
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- Seed test embedding pipeline
INSERT INTO documents.embedding_pipelines (id, name, description)
VALUES
    (
        1,
        'test',
        'Test embedding pipeline for development'
    )
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- Seed document statuses
INSERT INTO documents.document_statuses (name, description)
VALUES
    (
        'uploaded',
        'Document has been uploaded'
    ),
    (
        'processing',
        'Document is being parsed and embedded'
    ),
    (
        'indexed',
        'Document is fully processed and searchable'
    ),
    (
        'failed',
        'Document processing failed'
    )
ON CONFLICT (name) DO UPDATE
SET
    description = EXCLUDED.description;

-- Seed document operation types
INSERT INTO documents.document_operation_types (name, description)
VALUES
    (
        'uploaded',
        'Document was uploaded'
    ),
    (
        'processing_started',
        'Document processing was started'
    ),
    (
        'indexed',
        'Document processing completed and the document became searchable'
    ),
    (
        'failed',
        'Document processing failed'
    ),
    (
        'deleted',
        'Document was deleted'
    )
ON CONFLICT (name) DO UPDATE
SET
    description = EXCLUDED.description;

-- +goose Down
-- Remove document operation types
DELETE FROM documents.document_operation_types
WHERE name IN ('uploaded', 'processing_started', 'indexed', 'failed', 'deleted');

-- Remove document statuses
DELETE FROM documents.document_statuses
WHERE name IN ('uploaded', 'processing', 'indexed', 'failed');

-- Remove test pipelines
DELETE FROM documents.embedding_pipelines WHERE id = 1;
DELETE FROM documents.ingestion_pipelines WHERE id = 1;

-- Remove embedding models
DELETE FROM embeddings.embedding_models
WHERE name IN ('all-MiniLM-L6-v2', 'Qwen3-Embedding-0.6B', 'Qwen3-Embedding-8B');
