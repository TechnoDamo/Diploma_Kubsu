# Deployment Guide

## Deployment Shape

The backend is deployed as one codebase with two runtime processes:

- `api`
  Serves HTTP traffic.
- `worker`
  Polls PostgreSQL for durable jobs and executes background work.

Both processes require access to:

- the same PostgreSQL database
- the same filesystem-backed document storage
- the same external services: Docling, TEI, and an LLM provider compatible with the configured `LLM_API_TYPE`
- the same prompt-template directory mounted at `PROMPTS_DIR`

## Container-First Baseline

The repository now includes a portable local backend stack in [`api/docker-compose.yaml`](/Users/damir/Documents/Diploma_Kubsu/api/docker-compose.yaml).

That compose file starts:

1. `postgres-vector`
2. `migrator`
3. `api`
4. `worker`

The default compose baseline is intentionally able to run without Docling, TEI, or a real LLM provider by enabling local fallbacks.
Its external-service URLs are placeholder internal hostnames, so the expected smoke-test behavior is fallback-backed unless you wire real provider containers or remote endpoints.

What this baseline is good for:

1. API and worker startup verification
2. migration verification
3. local file-storage verification
4. durable job-flow verification
5. text/plain upload and RAG smoke testing

What it is not meant to prove:

1. provider-backed parsing quality
2. provider-backed embedding quality
3. provider-backed LLM answer quality

## Deployment Prerequisites

1. Database schema is migrated before backend rollout.
2. Shared file storage is mounted for both `api` and `worker`.
3. External service endpoints are reachable from both processes.
4. Prompt template files are present and readable at `PROMPTS_DIR`.
5. Environment variables are configured consistently across `api` and `worker`.

## Recommended Rollout Order

1. Deploy PostgreSQL and run Goose migrations.
2. Deploy or confirm availability of Docling, TEI, and the configured LLM provider.
3. Deploy the `worker`.
4. Deploy the `api`.
5. Check `/healthz` on the API and process logs on both runtimes.

## Local Container Run

From the repository root:

1. `cd api`
2. Start the full backend baseline:
   `docker compose up --build -d`
3. Check logs:
   `docker compose logs -f postgres-vector migrator api worker`
4. Run the smoke test:
   `bash ./scripts/smoke_test.sh`
5. Stop the stack:
   `docker compose down -v`

Equivalent shortcuts are available through [`Makefile`](/Users/damir/Documents/Diploma_Kubsu/api/Makefile):

- `make docker-up`
- `make docker-logs`
- `make docker-smoke`
- `make docker-down`

## Local Process Run

If you prefer process-based local development instead of containers:

1. Start PostgreSQL separately.
2. Ensure Docling, TEI, and the configured LLM provider are running, or keep fallbacks enabled.
3. In `api/`, copy `.env.example` to `.env`.
4. Export the environment variables from `.env`.
5. Start the API:
   `go run ./cmd/api`
6. Start the worker:
   `go run ./cmd/worker`

## Container Build

The backend includes a multi-stage Dockerfile at [`Dockerfile`](/Users/damir/Documents/Diploma_Kubsu/api/Dockerfile).
The runtime image now includes the startup prompt files under `/app/prompts`.

Example build:

```bash
docker build -t mimir-backend ./api
```

Run API container:

```bash
docker run --rm \
  --env-file ./api/.env \
  -p 8080:8080 \
  -v "$(pwd)/api/var/files:/app/var/files" \
  mimir-backend /app/mimir-api
```

Run worker container:

```bash
docker run --rm \
  --env-file ./api/.env \
  -v "$(pwd)/api/var/files:/app/var/files" \
  mimir-backend /app/mimir-worker
```

The compose stack is the preferred path because it also provisions PostgreSQL and runs migrations automatically.

## Shared Storage Requirement

`FILES_ROOT_DIR` must resolve to the same underlying storage for both runtimes. If `api` writes uploaded files to one disk and `worker` reads from another, document processing will fail.

For MVP:

- local development can use a shared local directory
- server deployment can use a shared host path or mounted volume

## Health And Observability

Current operational checks:

1. API health endpoint:
   `GET /healthz`
2. structured logs from both `api` and `worker`
3. PostgreSQL migration status from the `knowledge_db` package
4. successful Docker build of the backend image

Recommended minimum deployment checks:

1. API returns `200` from `/healthz`
2. worker logs show polling without connection failures
3. PostgreSQL is reachable from both runtimes
4. shared file storage is writable by the API and readable by the worker
5. prompt files are present inside the runtime image at `/app/prompts`

## Release Notes For MVP

Current deployment limitations:

1. generated `sqlc` and `oapi-codegen` outputs are not committed yet
2. local filesystem storage is an MVP decision, not the final long-term storage model
3. the default compose stack validates fallback-backed behavior first, not provider-backed model quality
4. provider-backed quality still depends on real Docling, TEI, and LLM-provider availability
5. project reindex orchestration is not implemented yet, even though the runtime already honors the `reindexing` availability gate if that state is set in the database
