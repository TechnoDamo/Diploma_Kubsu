-- +goose Up
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS embeddings;
CREATE SCHEMA IF NOT EXISTS documents;
CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE embeddings.embedding_models (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    dimension INTEGER NOT NULL CHECK (dimension > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX idx_embedding_models_name
    ON embeddings.embedding_models (name);

CREATE TABLE documents.projects (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    context TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE documents.document_operation_types (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_document_operation_types_name
    ON documents.document_operation_types (name);

CREATE TABLE documents.document_statuses (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_document_statuses_name
    ON documents.document_statuses (name);

CREATE TABLE documents.ingestion_pipelines (
    id BIGINT PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE documents.embedding_pipelines (
    id BIGINT PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE documents.documents (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES documents.projects(id),
    document_status_id BIGINT NOT NULL REFERENCES documents.document_statuses(id),
    ingestion_pipeline_id BIGINT NOT NULL REFERENCES documents.ingestion_pipelines(id),
    embedding_pipeline_id BIGINT NOT NULL REFERENCES documents.embedding_pipelines(id),
    name VARCHAR(500) NOT NULL,
    description TEXT,
    file_address VARCHAR(1000) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    language VARCHAR(32),
    total_chunks INTEGER NOT NULL DEFAULT 0,
    total_token_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_documents_file_address
    ON documents.documents (file_address);
CREATE INDEX idx_documents_checksum
    ON documents.documents (checksum);
CREATE INDEX idx_documents_project_id
    ON documents.documents (project_id);

CREATE TABLE documents.document_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents.documents(id) ON DELETE CASCADE,
    chunk_order_id INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    token_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_document_chunks_document_id_chunk_order
    ON documents.document_chunks (document_id, chunk_order_id);
CREATE INDEX idx_document_chunks_document_id
    ON documents.document_chunks (document_id);

CREATE TABLE documents.document_history (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents.documents(id) ON DELETE CASCADE,
    operation_type_id BIGINT NOT NULL REFERENCES documents.document_operation_types(id),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_document_history_document_id
    ON documents.document_history (document_id);

CREATE TABLE embeddings.embeddings (
    id BIGSERIAL PRIMARY KEY,
    chunk_id BIGINT NOT NULL REFERENCES documents.document_chunks(id) ON DELETE CASCADE,
    model_id BIGINT NOT NULL REFERENCES embeddings.embedding_models(id),
    version INTEGER NOT NULL,
    embedding VECTOR NOT NULL,
    dimensionality INTEGER NOT NULL CHECK (dimensionality > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_embeddings_chunk_id_model_id_version
    ON embeddings.embeddings (chunk_id, model_id, version);
CREATE INDEX idx_embeddings_chunk_id
    ON embeddings.embeddings (chunk_id);
CREATE INDEX idx_embeddings_model_id
    ON embeddings.embeddings (model_id);

CREATE TABLE system.request_types (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE UNIQUE INDEX idx_request_types_name
    ON system.request_types (name);

CREATE TABLE system.request_history (
    id BIGSERIAL PRIMARY KEY,
    type_id BIGINT NOT NULL REFERENCES system.request_types(id),
    request_data JSONB NOT NULL,
    user_ip INET NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_request_history_type_id
    ON system.request_history (type_id);
CREATE INDEX idx_request_history_created_at
    ON system.request_history (created_at);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION documents.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER trg_projects_set_updated_at
    BEFORE UPDATE ON documents.projects
    FOR EACH ROW
    EXECUTE FUNCTION documents.set_updated_at();

CREATE TRIGGER trg_documents_set_updated_at
    BEFORE UPDATE ON documents.documents
    FOR EACH ROW
    EXECUTE FUNCTION documents.set_updated_at();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION embeddings.validate_embedding_dimensions()
RETURNS TRIGGER AS $$
DECLARE
    expected_dimension INTEGER;
BEGIN
    SELECT dimension
      INTO expected_dimension
      FROM embeddings.embedding_models
     WHERE id = NEW.model_id;

    IF expected_dimension IS NULL THEN
        RAISE EXCEPTION 'model_id % does not exist in embeddings.embedding_models', NEW.model_id;
    END IF;

    IF NEW.dimensionality <> expected_dimension THEN
        RAISE EXCEPTION
            'dimensionality % does not match model dimension % for model_id %',
            NEW.dimensionality, expected_dimension, NEW.model_id;
    END IF;

    IF vector_dims(NEW.embedding) <> NEW.dimensionality THEN
        RAISE EXCEPTION
            'vector dimensions % does not match dimensionality %',
            vector_dims(NEW.embedding), NEW.dimensionality;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER trg_embeddings_validate_dimensions
    BEFORE INSERT OR UPDATE ON embeddings.embeddings
    FOR EACH ROW
    EXECUTE FUNCTION embeddings.validate_embedding_dimensions();

-- +goose Down
DROP TRIGGER IF EXISTS trg_embeddings_validate_dimensions ON embeddings.embeddings;
DROP FUNCTION IF EXISTS embeddings.validate_embedding_dimensions();

DROP TRIGGER IF EXISTS trg_documents_set_updated_at ON documents.documents;
DROP TRIGGER IF EXISTS trg_projects_set_updated_at ON documents.projects;
DROP FUNCTION IF EXISTS documents.set_updated_at();

DROP TABLE IF EXISTS system.request_history;
DROP TABLE IF EXISTS system.request_types;
DROP TABLE IF EXISTS embeddings.embeddings;
DROP TABLE IF EXISTS documents.document_history;
DROP TABLE IF EXISTS documents.document_chunks;
DROP TABLE IF EXISTS documents.documents;
DROP TABLE IF EXISTS documents.embedding_pipelines;
DROP TABLE IF EXISTS documents.ingestion_pipelines;
DROP TABLE IF EXISTS documents.document_statuses;
DROP TABLE IF EXISTS documents.document_operation_types;
DROP TABLE IF EXISTS documents.projects;
DROP TABLE IF EXISTS embeddings.embedding_models;

DROP SCHEMA IF EXISTS system;
DROP SCHEMA IF EXISTS documents;
DROP SCHEMA IF EXISTS embeddings;

DROP EXTENSION IF EXISTS vector;
