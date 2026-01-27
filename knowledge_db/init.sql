-- Enable the vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table (persistent knowledge base)
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    description TEXT,
    address VARCHAR(1000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Document chunks table (persistent knowledge base chunks)
CREATE TABLE document_chunks (
    id SERIAL PRIMARY KEY,
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding VECTOR(512),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(doc_id, chunk_id)
);

-- Current search docs (completely separate - for contradiction analysis)
CREATE TABLE current_search_docs (
    id SERIAL PRIMARY KEY,
    doc_id VARCHAR(100) NOT NULL, -- Independent ID, not referencing documents.id
    name VARCHAR(500) NOT NULL,
    description TEXT,
    address VARCHAR(1000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Current search chunks (references current_search_docs, not documents)
CREATE TABLE current_search_chunks (
    id SERIAL PRIMARY KEY,
    doc_id INTEGER NOT NULL REFERENCES current_search_docs(id) ON DELETE CASCADE,
    chunk_id INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding VECTOR(512),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(doc_id, chunk_id)
);

-- Indexes for performance
CREATE INDEX idx_document_chunks_doc_id ON document_chunks(doc_id);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_current_search_chunks_doc_id ON current_search_chunks(doc_id);
CREATE INDEX idx_current_search_chunks_embedding ON current_search_chunks USING ivfflat (embedding vector_cosine_ops);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_documents_updated_at 
    BEFORE UPDATE ON documents 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();