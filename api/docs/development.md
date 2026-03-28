# Backend Development Guide

## Purpose

This document explains how the backend codebase is organized and how new implementation work should be added without eroding the intended architecture.

## Current Code Layout

- `cmd/api`
  API entrypoint. Owns process startup and graceful shutdown for HTTP traffic.
- `cmd/worker`
  Worker entrypoint. Owns process startup and graceful shutdown for durable async work.
- `internal/app`
  Shared application bootstrap. Constructs configuration, logger, validator, database pool, storage, and external clients.
- `internal/config`
  Typed environment configuration.
- `prompts`
  Startup-loaded LLM task templates for RAG rewrite, RAG answer generation, contradiction discovery, and contradiction summarization.
- `internal/httpapi`
  Router and HTTP handlers.
- `internal/modules`
  Business-domain service boundaries.
- `internal/infra`
  Database and external-provider adapters.
- `internal/worker`
  Durable job polling and execution orchestration.
- `scripts`
  Local verification helpers such as the container smoke test.
- `sql/queries`
  SQL source files used by `sqlc`.
- `docs`
  Architecture, ADRs, workflows, and development guidance.

## Design Rules

1. Transport code must stay in `internal/httpapi`.
2. External provider details must stay in `internal/infra`.
3. Business logic should live in `internal/modules`, not in handlers or worker poll loops.
4. Worker code should coordinate jobs, not own domain rules.
5. SQL should stay explicit and live in `sql/queries` whenever it becomes stable enough for `sqlc`.
6. Prompt wording should live in `prompts/` files, while prompt composition should stay inside domain modules.

## Generated Code Workflow

Generated code is intentionally not committed yet, but the source configuration is already present.

Expected workflow:

1. Update the OpenAPI contract if transport shape changes.
2. Update SQL query files if persistence behavior changes.
3. Run:
   - `sqlc generate`
   - `oapi-codegen -config oapi-codegen.yaml ../api-docs-swagger/specs/mimir-rag-api.yaml`
4. Adapt repositories and handlers to the generated output.
5. Run formatting and tests.

## How To Add New Backend Behavior

### New HTTP endpoint behavior

1. Update the OpenAPI contract first.
2. Regenerate transport code.
3. Implement handler logic.
4. Delegate business rules into a module service.
5. Add or update SQL queries as needed.

### New async job behavior

1. Define or update the durable job table contract.
2. Add queue and claim queries in `sql/queries`.
3. Add worker execution logic.
4. Keep status transitions explicit and observable.

### New provider integration

1. Add a new client under `internal/infra`.
2. Hide it behind an internal interface.
3. Keep provider-specific request and response shapes out of module code.

## MVP Implementation Priority

1. Generate `sqlc` and `oapi-codegen` output once the toolchain is installed.
2. Extend the implemented project CRUD slice with repository generation and tests.
3. Implement document upload persistence and file storage.
4. Implement document-processing job enqueueing and worker execution.
5. Implement document text reconstruction from stored chunks.
6. Implement RAG query orchestration.
7. Implement contradiction-analysis enqueueing, polling, and worker execution.
8. Add admin-only config change and reindex triggers.
