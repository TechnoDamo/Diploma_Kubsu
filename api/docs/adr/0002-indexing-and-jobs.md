# ADR 0002: Project Indexing and Durable Jobs

## Status

Accepted

## Context

The backend needs to support:

- per-project indexing configuration
- full-project reindexing when indexing config changes
- durable async document processing
- durable async contradiction analysis
- deletion rules that depend on active job references

## Decision

Adopt the following persistence model:

- `documents.project_index_configs`
  Stores versioned per-project indexing configuration.
- `documents.document_processing_jobs`
  Stores durable document ingestion and reindex jobs.
- `analysis.analysis_jobs`
  Stores durable contradiction-analysis execution state.
- `analysis.analysis_job_targets`
  Stores target-document references relationally for active analysis jobs.

Documents snapshot the effective indexing configuration used when they were processed:

- pipeline IDs
- embedding model ID
- embedding dimension
- parser and chunking metadata
- index version

Chunk reconstruction is based on ordered chunks plus explicit character offsets.

## Consequences

### Positive

- project-level embedding and chunking changes are auditable
- deletion checks remain clear because active analysis targets are relational
- durable jobs survive process restarts
- chunk-derived `/text` remains deterministic enough for MVP

### Negative

- more schema surface than a naive MVP
- reindexing temporarily disables the project instead of providing zero-downtime index switching
- worker logic must coordinate multiple job tables and project-config state transitions

## Alternatives Considered

### One generic jobs table

Rejected for MVP because document processing and contradiction analysis have materially different payloads and lifecycle semantics.

### No project config versioning

Rejected because project-specific embedding and chunking changes would become hard to reason about or audit.

### Storing analysis targets only inside JSON

Rejected because delete-blocking and active-reference checks become weaker and harder to query cleanly.
