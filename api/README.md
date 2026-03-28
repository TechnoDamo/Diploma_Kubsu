# Mimir Backend

Go backend foundation for the Mimir modular monolith.

## Runtime Shape

- `cmd/api`
  HTTP API process.
- `cmd/worker`
  Background worker process for durable database-backed jobs.
- shared `internal/` packages
  Business modules, infrastructure adapters, and configuration.

This backend is intentionally implemented as a modular monolith:

- one repository
- one PostgreSQL database
- one deployable backend codebase
- two runtime entrypoints with separate responsibilities

## Selected Stack

- HTTP router: `chi`
- Config: `cleanenv` + plain environment variables
- Logging: standard `log/slog`
- PostgreSQL driver: `pgx`
- Query generation: `sqlc`
- Migrations: `goose`
- OpenAPI integration: `oapi-codegen`
- Request validation: `go-playground/validator`

Detailed rationale lives in [docs/architecture.md](./docs/architecture.md) and [docs/adr/0001-backend-foundation.md](./docs/adr/0001-backend-foundation.md).
More implementation detail lives in:

- [docs/technology-choices.md](./docs/technology-choices.md)
- [docs/workflows.md](./docs/workflows.md)
- [docs/development.md](./docs/development.md)
- [docs/environment.md](./docs/environment.md)
- [docs/deployment.md](./docs/deployment.md)
- [docs/testing.md](./docs/testing.md)
- [docs/adr/0002-indexing-and-jobs.md](./docs/adr/0002-indexing-and-jobs.md)

Prompt templates are loaded at startup from [`prompts/`](./prompts):

- `rag_request.txt`
- `rag_response.txt`
- `contradiction_discovery.txt`
- `contradiction_summary.txt`

## Generation

The repository keeps generation config checked in, but generated code is not committed yet.

Planned commands:

```bash
sqlc generate
oapi-codegen -config oapi-codegen.yaml ../api-docs-swagger/specs/mimir-rag-api.yaml
```

## Local Development

1. Create a local environment file if you want one:
   `cp .env.example .env`
2. Export the variables into your shell before starting processes.
3. Start required dependencies from the repository root:
   - PostgreSQL from `knowledge_db`
   - Docling Serve
   - TEI
   - an LLM provider reachable through the configured `LLM_API_TYPE`
4. Start the API:
   `go run ./cmd/api`
5. Start the worker in a second terminal:
   `go run ./cmd/worker`

Detailed setup instructions live in [docs/environment.md](./docs/environment.md) and [docs/deployment.md](./docs/deployment.md).

## Container-First Local Stack

The backend now ships with a container-first local deployment in [`docker-compose.yaml`](/Users/damir/Documents/Diploma_Kubsu/api/docker-compose.yaml).

Default stack contents:

- `postgres-vector`
- `migrator`
- `api`
- `worker`

This compose stack now expects real dependency endpoints for Docling, TEI, and the configured LLM provider. Both `api` and `worker` run with `DEPENDENCY_STARTUP_CHECKS_ENABLED=true`, so startup fails fast if TEI or the LLM model are unreachable.

Use:

```bash
cd api
make docker-up
make docker-smoke
make docker-logs
make docker-down
```

Before running the compose stack, wire reachable Docling, TEI, and LLM endpoints into the environment or adjust the compose file to point at real containers/services.

## Current State

This backend foundation includes:

- project structure
- shared application bootstrap
- configuration model
- database and external client boundaries
- startup-loaded prompt templates
- API and worker bootstrap
- container-first local stack and smoke-test script
- strict dependency startup validation for TEI and the configured LLM model
- implemented project CRUD and bootstrap index-config creation
- implemented document upload, content, text, and deletion flows
- implemented durable document processing and contradiction-analysis worker paths
- implemented synchronous RAG and async contradiction-analysis service logic
- SQL query definitions for `sqlc`
- architecture documentation

The next implementation phase should fill in:

- generated DB and OpenAPI code
- stronger repository extraction around generated `sqlc` queries
- richer integration and end-to-end automated tests
- admin config-change and reindex endpoints
