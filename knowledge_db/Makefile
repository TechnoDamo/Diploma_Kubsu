SHELL := /bin/bash

.PHONY: help up down reset logs migrate-up migrate-status migrate-down migrate-create

help:
	@echo "Available targets:"
	@echo "  make up                  Start Postgres and run migrator"
	@echo "  make down                Stop all services"
	@echo "  make reset               Stop services and remove volumes"
	@echo "  make logs                Tail postgres and migrator logs"
	@echo "  make migrate-up          Apply pending migrations"
	@echo "  make migrate-status      Show migration status"
	@echo "  make migrate-down        Roll back one migration"
	@echo "  make migrate-create NAME=<migration_name>  Create new SQL migration"

up:
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose up -d'

down:
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose down'

reset:
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose down -v'

logs:
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose logs -f postgres-vector migrator'

migrate-up:
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose run --rm migrator -dir /workspace/migrations postgres "host=postgres-vector port=5432 user=$$POSTGRES_USER password=$$POSTGRES_PASSWORD dbname=$$POSTGRES_DB sslmode=disable" up'

migrate-status:
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose run --rm migrator -dir /workspace/migrations postgres "host=postgres-vector port=5432 user=$$POSTGRES_USER password=$$POSTGRES_PASSWORD dbname=$$POSTGRES_DB sslmode=disable" status'

migrate-down:
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose run --rm migrator -dir /workspace/migrations postgres "host=postgres-vector port=5432 user=$$POSTGRES_USER password=$$POSTGRES_PASSWORD dbname=$$POSTGRES_DB sslmode=disable" down'

migrate-create:
	@if [ -z "$(NAME)" ]; then echo "Usage: make migrate-create NAME=<migration_name>"; exit 1; fi
	@bash -lc '. ./.env/load_env.sh >/dev/null; docker compose run --rm migrator -dir /workspace/migrations create "$(NAME)" sql'
