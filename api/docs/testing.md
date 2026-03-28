# Testing Guide

## Testing Levels

The backend should be tested at three levels.

### 1. Unit Tests

Focus on deterministic logic that does not require infrastructure:

- chunking behavior
- vector formatting
- small request/response mapping helpers

Run locally:

```bash
go test ./...
```

### 2. Integration Tests

Focus on backend modules that depend on PostgreSQL and durable job state:

- project creation and bootstrap index config insertion
- document upload persistence and queue insertion
- worker claim/update behavior
- deletion blocking by active jobs

Preferred approach:

- use `testcontainers-go` with PostgreSQL + pgvector enabled
- apply Goose migrations inside the test environment

### 3. End-to-End Tests

Focus on the full running system:

- upload document
- worker indexes document
- fetch `/text`
- run `/rag/query`
- start contradiction analysis
- poll until completion

These tests should run against the real runtime shape:

- `api`
- `worker`
- PostgreSQL
- Docling
- TEI
- the real LLM provider

## Containerized Verification

The preferred portable verification path is the compose-based backend stack:

```bash
cd api
docker compose up --build -d
bash ./scripts/smoke_test.sh
docker compose logs -f postgres-vector migrator api worker
docker compose down -v
```

That compose stack no longer validates fake fallback behavior. It should be run only when Docling, TEI, and the configured LLM provider are genuinely reachable, because startup checks now fail fast otherwise.

If you only want image-level compilation and unit-test validation:

```bash
docker build -t mimir-backend ./api
```

The Docker build runs `go test ./...` before producing runtime binaries.

## Recommended MVP Test Matrix

### Happy path

1. create project
2. upload plain-text document
3. run worker
4. verify document becomes `indexed`
5. fetch `/documents/{id}/text`
6. query `/rag/query`
7. start contradiction analysis and poll the job
8. verify prompt files are loaded and reachable from both runtimes

### Conflict and validation path

1. duplicate project name returns `409`
2. unsupported upload MIME returns `415`
3. oversized upload returns `413`
4. deleting document with active job returns `409`
5. contradiction analysis with non-indexed base document returns `409`

### Reindex gate path

1. manually mark a project config as `reindexing` in the database
2. verify uploads return `409`
3. verify RAG returns `409`
4. verify contradiction-analysis start returns `409`

The runtime gate is implemented today. The admin/API flow that starts and completes a reindex is still a planned feature.

## Current Limitation

This repository currently contains the implementation and the testing guidance, but real compose execution still depends on a container runtime being available on the machine. If Docker or an equivalent runtime is absent, image builds and compose-based smoke tests cannot be executed locally.
