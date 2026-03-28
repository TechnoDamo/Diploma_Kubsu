# Environment Reference

## Overview

The backend is configured entirely through environment variables loaded with `cleanenv`.

LLM prompt templates are loaded from files at startup through `PROMPTS_DIR`.

For local development, [`.env.example`](../.env.example) can be copied to `.env` as a template, but the process still expects variables to be present in the environment. A common pattern is:

```bash
set -a
source .env
set +a
```

For the standard local Go runtime, you can use:

```bash
./scripts/start_local.sh
```

That script loads `.env`, exports the variables, uses workspace-local Go cache directories, starts both backend processes, and writes logs to `api/var/log/`.

## Core Runtime

- `APP_ENV`
  Runtime environment label. Example: `development`.
- `LOG_LEVEL`
  Structured log verbosity. Typical values: `DEBUG`, `INFO`, `WARN`, `ERROR`.
- `ENABLE_LOCAL_FALLBACKS`
  Enables only limited UTF-8 text parsing fallback when Docling fails on textual content. It does not replace TEI embeddings or LLM completions.
- `DEPENDENCY_STARTUP_CHECKS_ENABLED`
  When enabled, both `api` and `worker` fail startup if TEI or the configured LLM model are unreachable.

## HTTP Server

- `HTTP_HOST`
  Bind host for the API process.
- `HTTP_PORT`
  Bind port for the API process.
- `HTTP_PUBLIC_BASE_URL`
  Public base URL used in generated links and cross-service callbacks.
- `HTTP_READ_TIMEOUT`
  Maximum duration for reading the request.
- `HTTP_WRITE_TIMEOUT`
  Maximum duration for writing the response.
- `HTTP_IDLE_TIMEOUT`
  Keep-alive idle timeout.
- `HTTP_MAX_UPLOAD_SIZE_BYTES`
  Maximum accepted upload size.

## PostgreSQL

- `POSTGRES_DSN`
  PostgreSQL connection string for both `api` and `worker`.
- `POSTGRES_MAX_CONNS`
  Maximum connection pool size.
- `POSTGRES_MIN_CONNS`
  Minimum connection pool size.

## Worker

- `WORKER_POLL_INTERVAL`
  Frequency of polling the database for queued jobs.
- `WORKER_BATCH_SIZE`
  Reserved for worker batch-oriented processing behavior.

## File Storage

- `FILES_ROOT_DIR`
  Root directory for locally stored original uploaded files.

This directory must be persistent in any deployment where document content must survive restarts.

## Prompt Templates

- `PROMPTS_DIR`
  Directory containing the startup-loaded prompt templates:
  - `rag_request.txt`
  - `rag_response.txt`
  - `contradiction_discovery.txt`
  - `contradiction_summary.txt`

## External Services

- `DOCLING_BASE_URL`
  Base URL for the document parsing service.
- `TEI_BASE_URL`
  Base URL for the text-embeddings-inference service.
- `TEI_EMBED_BATCH_SIZE`
  Number of chunk texts sent in a single TEI embedding request during indexing.
- `LLM_PROVIDER`
  Logical provider label used for logs and future routing decisions.
- `LLM_API_TYPE`
  API contract family used by the active adapter. The first supported value is `openai_compatible`.
- `LLM_PROVIDER_BASE_URL`
  Base URL for the current LLM provider.
- `LLM_PROVIDER_API_KEY`
  Secret API key for the current LLM provider.
- `LLM_MODEL_NAME`
  Chat model used for query rewrite, answer generation, and contradiction judgement.

## Global RAG Defaults

- `QUERY_REWRITE_DEFAULT_ENABLED`
  Enables or disables query rewriting by default when a project does not override it.
- `RAG_RETRIEVAL_TOP_K`
  Default retrieval breadth when a project does not override it.
- `RAG_CONTEXT_TOP_N`
  Default number of retrieved chunks actually passed to the answer-generation prompt.

## Contradiction Defaults

- `CONTRADICTION_MAX_DISTANCE`
  Maximum allowed embedding distance for a candidate pair to be sent to the LLM.
- `CONTRADICTION_TOP_K_PER_BASE_CHUNK`
  Number of nearest target chunks collected per base chunk before distance filtering.
- `CONTRADICTION_MAX_PAIRS_PER_JOB`
  Hard upper bound on LLM pair evaluations for a single contradiction-analysis job.

## Project-Level Runtime Overrides

Projects can override selected runtime RAG defaults in the database through internal/admin configuration:

- `query_rewrite_enabled`
- `retrieval_top_k`
- `context_top_n`

If a project field is `NULL`, the backend falls back to the global environment default.

## Project Bootstrap Index Defaults

These values are used when a new project is created and its first active `project_index_config` is inserted.

- `PROJECT_INDEX_DEFAULTS_INGESTION_PIPELINE_ID`
- `PROJECT_INDEX_DEFAULTS_EMBEDDING_PIPELINE_ID`
- `PROJECT_INDEX_DEFAULTS_EMBEDDING_MODEL_NAME`
- `PROJECT_INDEX_DEFAULTS_EMBEDDING_DIMENSION`
- `PROJECT_INDEX_DEFAULTS_PARSER_NAME`
- `PROJECT_INDEX_DEFAULTS_PARSER_VERSION`
- `PROJECT_INDEX_DEFAULTS_CHUNKING_STRATEGY`
- `PROJECT_INDEX_DEFAULTS_CHUNK_SIZE`
- `PROJECT_INDEX_DEFAULTS_CHUNK_OVERLAP`
- `PROJECT_INDEX_DEFAULTS_CHUNK_UNIT`
- `PROJECT_INDEX_DEFAULTS_TOKENIZER_NAME`

These should match seeded dictionary rows and the TEI model actually serving embeddings.

## Required Alignment Rules

1. `PROJECT_INDEX_DEFAULTS_EMBEDDING_MODEL_NAME` must exist in `embeddings.embedding_models`.
2. `PROJECT_INDEX_DEFAULTS_INGESTION_PIPELINE_ID` must exist in `documents.ingestion_pipelines`.
3. `PROJECT_INDEX_DEFAULTS_EMBEDDING_PIPELINE_ID` must exist in `documents.embedding_pipelines`.
4. `PROJECT_INDEX_DEFAULTS_EMBEDDING_DIMENSION` must match the vector size produced by the active TEI model.

The backend validates these rules at startup when dependency checks are enabled, so invalid local configuration fails fast instead of breaking later during project creation or indexing.
