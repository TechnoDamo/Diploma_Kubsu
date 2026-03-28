# ADR 0001: Backend Foundation

## Status

Accepted

## Context

The project needs a backend that:

- supports synchronous HTTP APIs for CRUD and RAG
- supports durable asynchronous jobs for document processing and contradiction analysis
- can evolve toward richer indexing and provider switching
- remains simple enough for MVP development

## Decision

Adopt a Go-based modular monolith with:

- `chi` for HTTP routing
- `cleanenv` plus plain environment variables for configuration
- `log/slog` for structured logging
- `pgx` for PostgreSQL access
- `sqlc` for generated query code
- `goose` for schema migrations
- `oapi-codegen` for OpenAPI-aligned transport code
- `go-playground/validator` for request validation

Runtime split:

- `api` process
- `worker` process

Persistence:

- project index config versions in PostgreSQL
- durable job tables in PostgreSQL
- filesystem storage for original documents in MVP

## Consequences

### Positive

- strong fit for the project's SQL-first database design
- durable async execution without extra queue infrastructure
- low operational overhead
- easy future provider replacement

### Negative

- backend remains responsible for job orchestration details
- generated-code workflow must be maintained
- local filesystem storage is an MVP-only compromise

## Alternatives Considered

### Single process only

Rejected because in-process background work weakens durability and blurs responsibility.

### Microservices from the start

Rejected because the operational cost is too high for the current maturity level.

### ORM-first data layer

Rejected because the project already has a SQL-driven schema and benefits from explicit SQL control.

