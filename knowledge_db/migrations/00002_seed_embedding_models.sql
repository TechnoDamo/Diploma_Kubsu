-- +goose Up
INSERT INTO embeddings.embedding_models (name, description, dimension, is_active)
VALUES
    (
        'text-embedding-3-small',
        'OpenAI text embedding model',
        1536,
        TRUE
    ),
    (
        'text-embedding-3-large',
        'OpenAI text embedding model',
        3072,
        TRUE
    )
ON CONFLICT (name) DO UPDATE
SET
    description = EXCLUDED.description,
    dimension = EXCLUDED.dimension,
    is_active = EXCLUDED.is_active;

-- +goose Down
DELETE FROM embeddings.embedding_models
WHERE name IN ('text-embedding-3-small', 'text-embedding-3-large');
