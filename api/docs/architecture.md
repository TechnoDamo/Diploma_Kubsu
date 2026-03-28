# Backend Architecture

## Overview

The backend is implemented as a modular monolith with two runtime processes:

- `api`
  owns HTTP request handling, validation, persistence orchestration, and job enqueueing
- `worker`
  owns durable asynchronous execution for document processing and contradiction analysis

Both processes share:

- the same codebase
- the same PostgreSQL database
- the same filesystem-backed document store
- the same external service adapters

## Why This Shape

This structure keeps the codebase operationally simple while still separating:

- latency-sensitive request handling
- long-running parsing, embedding, and analysis work

It also avoids premature infrastructure such as Redis, RabbitMQ, or Kafka.

## Core Boundaries

### Application Bootstrap

`internal/app`

Owns process-wide construction of:

- config
- logger
- validator
- database pool
- filesystem storage
- external provider clients
- startup-loaded prompt templates

### HTTP Layer

`internal/httpapi`

- routing
- request parsing
- transport validation
- response shaping
- middleware

### Modules

`internal/modules/...`

Business logic grouped by domain:

- projects
- documents
- indexing
- rag
- analysis

Modules must not know about `chi`, raw environment parsing, or provider-specific HTTP details.

### Infrastructure

`internal/infra/...`

Adapters for:

- PostgreSQL
- filesystem storage
- Docling Serve
- TEI
- LLM providers behind a shared API-type abstraction

### Worker

`internal/worker`

Owns:

- job polling
- job claiming
- retry orchestration
- processing pipelines

## Persistence Strategy

### Project Index Configuration

`documents.project_index_configs`

This table is versioned and stores project-level indexing configuration:

- ingestion pipeline
- embedding pipeline
- embedding model
- embedding dimension
- parser and chunking metadata
- index generation status and version history

### Documents

`documents.documents`

Documents snapshot the effective index configuration used during processing.

This makes reindex behavior explicit and auditable.

### Document Processing Jobs

`documents.document_processing_jobs`

Durable job records for:

- initial ingestion
- project reindex processing

### Analysis Jobs

`analysis.analysis_jobs`
`analysis.analysis_job_targets`

Durable contradiction-analysis execution plus relational target references.

The results are stored as `jsonb` to keep MVP persistence simple while preserving full output payloads.

## Reindexing Policy

When project indexing configuration changes:

- a new config version is created
- the project enters reindexing state
- document mutations and query-style operations should be blocked
- the worker rebuilds the project against the new version
- the project becomes available again only after successful completion

## External Services

### Docling Serve

Used for document parsing.

### TEI

Used for embeddings.

The backend treats TEI as a stable embedding HTTP contract, while project-level config decides which model and dimensionality are active.

### LLM Provider

DeepSeek is the first configured provider, but the runtime dispatches by `LLM_API_TYPE` rather than by vendor name.

The first supported API contract is `openai_compatible`.

Provider access must be hidden behind an internal interface so future providers can be added without changing module logic.

## Prompting And Runtime Defaults

The backend currently uses four startup-loaded prompt templates:

- `rag_request.txt`
- `rag_response.txt`
- `contradiction_discovery.txt`
- `contradiction_summary.txt`

Global environment variables provide runtime defaults for:

- query rewrite enablement
- retrieval breadth
- answer-context depth
- contradiction candidate filtering

Projects can override selected RAG runtime values in the database without changing the shared provider configuration:

- `query_rewrite_enabled`
- `retrieval_top_k`
- `context_top_n`

That split is intentional:

- project config owns document indexing and project-specific retrieval behavior
- process env owns provider wiring, dependency startup checks, and global runtime defaults
