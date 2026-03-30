# Embedding Pipeline

## Purpose

This document describes where embeddings are created in the backend, which configuration values control them, and how the indexing-time and query-time paths work end to end.

The key boundary is:

- HTTP handlers do not create embeddings directly
- the worker creates document chunk embeddings asynchronously during indexing
- the RAG module creates a query embedding synchronously during retrieval
- both paths use the same TEI HTTP client

## Main Code Entry Points

### Document indexing embeddings

- `internal/httpapi/handlers/documents.go`
  accepts uploads and delegates to the documents module
- `internal/modules/documents/service.go`
  stores the file, snapshots the active project index config onto the document row, and enqueues a processing job
- `internal/worker/worker.go`
  polls queued jobs and delegates document work to the indexing module
- `internal/modules/indexing/service.go`
  reads the file, extracts text, chunks it, requests embeddings from TEI, and persists chunk plus vector rows

### Query embeddings

- `internal/httpapi/handlers/rag.go`
  accepts `POST /projects/{projectId}/rag/query`
- `internal/modules/rag/service.go`
  optionally rewrites the question, embeds the effective query through TEI, and retrieves nearest stored chunk vectors from PostgreSQL

### Shared TEI adapter

- `internal/infra/tei/client.go`
  performs the `/embed` HTTP call and normalizes TEI response payloads into `[][]float32`

## Indexing-Time Flow

This is the flow for document embeddings created during upload processing.

1. The API receives `POST /projects/{projectId}/documents`.
2. The documents module validates project state and stores the original file on local storage.
3. The documents module loads the active `documents.project_index_configs` row for the project.
4. The documents module snapshots the active indexing settings onto `documents.documents`, including:
   - `embedding_model_id`
   - `embedding_dimension`
   - `index_version`
   - `chunk_size`
   - `chunk_overlap`
5. The documents module inserts a `documents.document_processing_jobs` row with status `queued`.
6. The worker claims the queued job with `FOR UPDATE SKIP LOCKED`.
7. The indexing module loads the document row and therefore the exact embedding settings that were active when the document was created.
8. The indexing module reads the original file bytes from local storage.
9. The indexing module extracts text:
   - `text/plain` and `text/markdown` are used directly
   - other supported formats are sent to Docling
   - if local fallbacks are enabled and the payload is valid UTF-8, the backend may fall back to direct text use when Docling fails
10. The extracted text is chunked with `support.ChunkText(...)`.
11. The chunker uses character-based chunking with overlap and prefers to cut on whitespace or punctuation when possible.
12. The indexing module opens a transaction for finalization.
13. Chunks are processed in batches of `TEI_EMBED_BATCH_SIZE`.
14. The backend first inserts `documents.document_chunks` rows batch by batch inside one transaction and collects their generated IDs.
15. The backend then sends chunk texts to TEI with up to `MAX_EMBEDDING_CONCURRENT_REQUESTS` in-flight requests for the current document job.
16. Each request body is shaped like:

```json
{
  "inputs": ["chunk 1", "chunk 2"],
  "dimensions": 1024
}
```

17. TEI returns one embedding per input chunk.
18. The backend decodes that response into `[][]float32`.
19. The backend verifies that the number of returned vectors matches the number of inserted chunk rows for that batch.
20. Embedding rows are written back transactionally in batch order so the document still commits atomically.
21. Each vector is persisted into `embeddings.embeddings` together with:
   - `chunk_id`
   - `model_id`
   - `version`
   - `dimensionality`
22. The embedding itself is serialized into a pgvector literal string before being inserted as `::vector`.
23. After all batches succeed, the document status is updated to `indexed` and token/chunk totals are stored on the document row.
24. If any batch fails, the transaction rolls back and the worker marks the processing job and the document as `failed`.

## Query-Time Flow

This is the flow used during RAG retrieval.

1. The API receives `POST /projects/{projectId}/rag/query`.
2. The RAG module validates that the project exists and is not reindexing.
3. The RAG module loads the active runtime settings for the project.
4. Those settings include:
   - `embedding_model_id`
   - `version`
   - `embedding_dimension`
   - `retrieval_top_k`
   - `context_top_n`
5. The service resolves the document scope:
   - explicit indexed target documents if provided
   - otherwise all indexed documents in the project
6. If query rewrite is enabled, the backend may rewrite the question with the LLM before retrieval.
7. The effective query text is embedded through the same TEI client used by indexing.
8. The resulting query vector is converted into a pgvector literal.
9. PostgreSQL retrieves the nearest stored chunk embeddings with the pgvector distance operator:

```sql
ORDER BY e.embedding <=> $5::vector
```

10. Retrieval is constrained to chunk embeddings with the same:
    - `model_id`
    - `version`
11. That alignment prevents mixing vectors generated by a different embedding model or index version.
12. The top results become citations, and the first `context_top_n` snippets are passed to the answer-generation prompt.

## Why Documents Snapshot Embedding Settings

The backend stores effective embedding settings on each document row instead of reading only from the latest project config at processing time.

This gives the system:

- reproducibility
  a document is indexed with the config version it was created for
- auditability
  the exact model, dimension, and chunking settings used for that document remain visible later
- safer reindexing
  a future reindex can create a new config version without silently changing how old queued jobs behave

## Configuration Alignment Rules

These values must agree with each other:

- `PROJECT_INDEX_DEFAULTS_EMBEDDING_MODEL_NAME` must exist in `embeddings.embedding_models`
- `PROJECT_INDEX_DEFAULTS_EMBEDDING_DIMENSION` must match the vector size emitted by the active TEI model
- the active TEI endpoint must satisfy the `/embed` contract used by `internal/infra/tei/client.go`

If those values drift apart, indexing or retrieval will fail, usually during startup checks, batch embedding, or vector insert/search operations.

## Tables Touched By The Embedding Pipeline

### During upload and enqueue

- `documents.documents`
- `documents.document_processing_jobs`
- `documents.document_history`

### During indexing finalization

- `documents.document_chunks`
- `embeddings.embeddings`
- `documents.documents`
- `documents.document_history`

## Operational Notes

- The worker is the only runtime path that creates document embeddings.
- TEI failures are treated as hard failures for the current batch.
- `MAX_EMBEDDING_CONCURRENT_REQUESTS` increases TEI parallelism within one document job, while database writes remain coordinated through one transaction.
- Query embeddings are synchronous because retrieval depends on them immediately.
- `support.DeterministicEmbedding(...)` is a support utility and is not part of the production indexing or RAG retrieval path.
