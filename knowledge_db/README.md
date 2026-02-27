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

## Embedding dimensions configuration

Dimensions are configured per model and enforced at DB level:

1. `embeddings.embedding_models.dimension` stores expected dimension.
2. `00002_seed_embedding_models.sql` seeds initial models/dimensions.
3. Trigger validation checks model dimension, row dimensionality, and `vector_dims(embedding)` consistency.

To change dimensions or allowed models, add a new migration that updates `embeddings.embedding_models`.

## Assets

1. ERD backup: [ERD_backup.json](./ERD_backup.json)
2. Visual ERD source image: [ERD.png](./ERD.png)
3. Optional diagram tooling: [chartdb](https://github.com/chartdb/chartdb)
