# Database Architecture And Usage

## Scope

This document defines how the `knowledge_db` database is designed, migrated, started, and operated.

## Principles

1. `database.dbml` is the design source of truth.
2. `migrations/*.sql` is the execution source of truth.
3. Schema changes are append-only via new migrations.
4. Runtime services do not mutate schema directly; migrator owns schema transitions.

## High-level architecture

## Components

1. `postgres-vector` service
   1. PostgreSQL 15 + pgvector
   2. Stores all application data
   3. Exposes healthcheck
2. `migrator` service
   1. One-shot Goose runner
   2. Waits for DB health
   3. Applies pending migrations and exits
3. `migrations/`
   1. Ordered SQL migration history
   2. Includes `Up` and `Down` sections per file

## Startup sequence

1. Start Postgres container.
2. Wait until `pg_isready` is healthy.
3. Start migrator and run `goose up`.
4. DB is ready for application traffic.

## Data model overview

## Schemas

1. `documents`: projects, project index configs, documents, chunks, processing jobs, lifecycle/history dictionaries.
2. `embeddings`: embedding models and vectors.
3. `analysis`: contradiction-analysis jobs and relational target references.
4. `system`: request type dictionary and request history.

## Core relation chain

1. `documents.projects` -> `documents.project_index_configs`
2. `documents.project_index_configs` -> `documents.documents`
3. `documents.documents` -> `documents.document_chunks`
4. `documents.document_chunks` -> `embeddings.embeddings`
5. `analysis.analysis_jobs` -> `analysis.analysis_job_targets`

## Embedding dimensions configuration

Dimensions are configured per project index version and enforced in DB:

1. `documents.project_index_configs.embedding_dimension` defines the intended vector size for that project config version.
2. `documents.documents.embedding_dimension` snapshots the applied value for each document.
3. `embeddings.embeddings.dimensionality` stores row-level declared dimension.
4. Trigger `embeddings.validate_embedding_dimensions()` enforces row dimensionality equals `vector_dims(embedding)`.

Selected RAG runtime defaults are stored on `documents.projects` rather than inside `documents.project_index_configs`:

1. `query_rewrite_enabled`
2. `retrieval_top_k`
3. `context_top_n`

This keeps project retrieval behavior configurable without mixing runtime RAG knobs into index-version history.

Default dictionary rows are seeded by `00002_seed_embedding_models.sql`.

## Chunk reconstruction model

Document text is reconstructed from ordered chunks:

1. `documents.document_chunks.chunk_order_id` defines stable order.
2. `documents.document_chunks.char_start` and `char_end` preserve deterministic reconstruction boundaries.
3. `documents.documents` stores chunking metadata such as strategy, size, overlap, unit, and tokenizer.

## Async persistence model

1. `documents.document_processing_jobs` stores durable ingestion and reindex work.
2. `analysis.analysis_jobs` stores durable contradiction-analysis work and result payloads as `jsonb`.
3. `analysis.analysis_job_targets` keeps active target references relational so delete checks remain simple.

## Day-to-day usage

## Preferred commands

Use `Makefile` targets:

1. `make up`: start DB + run migrator.
2. `make down`: stop services.
3. `make reset`: stop services and remove DB volume.
4. `make logs`: tail Postgres + migrator logs.
5. `make migrate-status`: show applied/pending migrations.
6. `make migrate-up`: apply pending migrations.
7. `make migrate-down`: roll back one migration (dev use).
8. `make migrate-create NAME=<migration_name>`: create a migration file.

## Typical local flow

1. `make reset` (only when you need a clean DB).
2. `make up`.
3. `make migrate-status`.

## Migration workflow

1. Update `database.dbml` with the intended design change.
2. Create migration file:
   `make migrate-create NAME=add_<feature>`
3. Implement `-- +goose Up` and `-- +goose Down`.
4. Apply and verify:
   1. `make migrate-up`
   2. `make migrate-status`
5. Commit DBML and migration together.

## Environment strategy

1. Local: automatic migrator at startup for fast iteration.
2. Staging: same flow as local for parity.
3. Production: run migrator as deployment gate before app rollout.

## Downtime policy

Current state allows maintenance windows. As data grows, apply expand-and-contract:

1. Expand schema (additive changes).
2. Backfill data.
3. Switch reads/writes.
4. Remove old schema in later migration.

## Operational checks

1. `docker compose ps`: Postgres is healthy.
2. `make migrate-status`: expected versions are applied.
3. `docker compose logs migrator`: no migration errors.

## Common pitfalls

1. Editing old migration files after they were applied.
2. Changing DB schema without a matching DBML update.
3. Running app writes before migrator completes.
4. Using destructive `down` migrations in shared/non-dev environments.
