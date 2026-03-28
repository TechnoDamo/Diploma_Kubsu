# Project Database

PostgreSQL + pgvector database package with deterministic Goose migrations.

## Architecture

1. `postgres-vector` service stores data.
2. `migrator` service runs once and applies pending migrations after DB healthcheck.
3. `database.dbml` defines schema design.
4. `migrations/*.sql` defines executable schema history.

Detailed architecture and operating model:
[docs/database_architecture_and_usage.md](./docs/database_architecture_and_usage.md)

## Source-of-truth policy

1. Design source: [database.dbml](./database.dbml)
2. Execution source: [migrations](./migrations)
3. Every schema change must update both DBML and add a new migration.

## Quick start

1. Fresh reset:
   `make reset`
2. Start database and migrator:
   `make up`
3. Verify applied migrations:
   `make migrate-status`

Result: DB is ready to serve after startup.

## Commands

1. `make up` start DB and run migrator
2. `make down` stop services
3. `make reset` stop and remove volumes
4. `make logs` tail Postgres and migrator logs
5. `make migrate-up` apply pending migrations
6. `make migrate-status` show migration state
7. `make migrate-down` rollback one migration (dev only)
8. `make migrate-create NAME=<migration_name>` create new SQL migration

## Migration development flow

1. Change target schema in [database.dbml](./database.dbml).
2. Create migration: `make migrate-create NAME=<change_name>`.
3. Fill `Up` and `Down` SQL.
4. Apply and verify:
   1. `make migrate-up`
   2. `make migrate-status`

## Schema highlights

1. `documents.projects` stores public `description`, internal `context`, and project-level RAG runtime overrides.
2. `documents.project_index_configs` stores versioned per-project indexing configuration.
3. `documents.documents` snapshots the effective parsing/indexing configuration used for the document.
4. `documents.document_chunks` stores ordered chunk text plus reconstruction offsets.
5. `documents.document_processing_jobs` stores durable ingestion and reindex jobs.
6. `analysis.analysis_jobs` and `analysis.analysis_job_targets` store contradiction-analysis execution and active references.

## Embedding dimensions configuration

Dimensions are configured per project index version and enforced at DB level:

1. `documents.project_index_configs.embedding_dimension` stores configured vector size.
2. `documents.documents.embedding_dimension` snapshots the applied value for each document.
3. `embeddings.embeddings.dimensionality` stores the row-level declared dimension.
4. Trigger validation checks `vector_dims(embedding)` against row dimensionality.

Changing embedding model or dimension should create a new project index config version and trigger project reindexing.

Selected RAG runtime defaults can be overridden per project:

1. `documents.projects.query_rewrite_enabled`
2. `documents.projects.retrieval_top_k`
3. `documents.projects.context_top_n`

If these are `NULL`, the backend falls back to environment-level defaults.

## Assets

1. ERD backup: [ERD_backup.json](./ERD_backup.json)
2. Visual ERD source image: [ERD.png](./ERD.png)
3. Optional diagram tooling: [chartdb](https://github.com/chartdb/chartdb)
