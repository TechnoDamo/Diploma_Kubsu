# Backend Workflows

## Upload and Document Processing

1. The API receives `POST /projects/{projectId}/documents`.
2. The API validates that the project exists and is not currently reindexing.
3. The original file is stored on local filesystem storage.
4. The API creates a `documents.documents` row with status `uploaded`.
5. The API enqueues a `documents.document_processing_jobs` row with status `queued`.
6. The API returns `201` immediately.
7. The worker claims the queued job with PostgreSQL row locking.
8. The worker parses the file through Docling, creates chunks, generates embeddings through TEI, writes chunk and embedding rows, and marks the document `indexed`.
9. On failure, the worker marks the job `failed` and the document `failed`.

For the container smoke-test baseline, this path is exercised with `text/plain` uploads so parsing does not require Docling, and embedding falls back locally if TEI is unavailable.

For provider-backed parsing today:

- `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` are sent to Docling for text extraction
- `text/plain` and `text/markdown` are ingested directly without Docling
- legacy `.doc` is not part of the supported MVP parsing contract

## RAG Query

1. The API receives `POST /projects/{projectId}/rag/query`.
2. The API rejects the request with `409` if the project is currently reindexing.
3. The service resolves the search scope:
   - explicit indexed target documents if provided
   - otherwise all indexed documents in the project
4. Unknown target IDs are ignored.
5. Known but non-indexed target IDs are ignored and may produce a warning message.
6. The service loads project prompt context and project-specific runtime overrides.
7. The service optionally rewrites the question with the LLM using `prompts/rag_request.txt`.
8. The service embeds the effective query through TEI.
9. The service retrieves the closest chunk embeddings from PostgreSQL using `retrieval_top_k`.
10. The service selects up to `context_top_n` retrieved chunks for answer generation.
11. The service builds the answer prompt from project context, the original question, the rewritten query, and selected retrieved chunks using `prompts/rag_response.txt`.
12. The API returns the answer plus citations.

## Contradiction Analysis

1. The API receives `POST /projects/{projectId}/analysis/contradictions`.
2. The API rejects the request with `409` if the project is reindexing.
3. The API rejects the request with `409 DOCUMENT_NOT_READY` if the base document is not indexed.
4. The API resolves effective target documents using the same target-ID rules as RAG.
5. The API inserts an `analysis.analysis_jobs` row with status `queued`.
6. The API inserts relational target rows into `analysis.analysis_job_targets`.
7. The API returns `202` with the job polling URL.
8. The worker claims the queued job and loads project prompt context.
9. For each base chunk, the worker retrieves up to `CONTRADICTION_TOP_K_PER_BASE_CHUNK` nearest target chunks.
10. Candidate pairs beyond `CONTRADICTION_MAX_DISTANCE` are discarded.
11. The worker evaluates at most `CONTRADICTION_MAX_PAIRS_PER_JOB` candidate pairs through the LLM using `prompts/contradiction_discovery.txt`.
12. For each target document with detected contradictions, the worker builds a document-level summary using `prompts/contradiction_summary.txt`.
13. The worker stores the final ranked contradiction payload as `jsonb`.
14. The worker marks the job `completed` or `failed`.

## Project Reindex

Current implementation status:

1. The runtime already honors the `reindexing` gate by blocking document mutations and query-style operations when a project has a config in `reindexing` status.
2. The admin/API workflow that creates a new config version and drives reindex execution is not implemented yet.

Planned target flow:

1. An admin-level backend operation creates a new `documents.project_index_configs` version.
2. The new config is marked `reindexing`.
3. While reindex is active, the project is temporarily unavailable for:
   - document uploads
   - document deletes
   - project deletes
   - RAG queries
   - contradiction analysis
4. Existing documents are reprocessed against the new config version.
5. When the last reindex job completes successfully, the new config becomes `active`.
6. Older configs are marked `superseded`.
7. If reindex fails, the new config becomes `failed` and the project remains unavailable until resolved administratively.
