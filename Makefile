COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.yml

LLM ?= cloud
EMBEDDING ?= cloud
DOCLING ?= local
POSTGRES ?= local
QDRANT ?= local
OBJECT_STORAGE ?= filesystem
GRAYLOG ?= local

PKG := 0
-include .env
-include .env.local
export

LOAD_ENV := set -a; \
    if [ -f ./.env ]; then . ./.env; fi; \
    set +a;

PROFILE_ARGS :=
PROFILE_ARGS += $(if $(filter local,$(LLM)),--profile local-llm,)
PROFILE_ARGS += $(if $(filter local,$(EMBEDDING)),--profile local-embedding,)
PROFILE_ARGS += $(if $(filter local,$(DOCLING)),--profile local-docling,)
PROFILE_ARGS += $(if $(filter local,$(POSTGRES)),--profile local-postgres,)
PROFILE_ARGS += $(if $(filter local,$(QDRANT)),--profile local-qdrant,)
PROFILE_ARGS += $(if $(filter local,$(OBJECT_STORAGE)),--profile local-object-storage,)
PROFILE_ARGS += $(if $(filter local,$(GRAYLOG)),--profile local-graylog,)

ALL_PROFILE_ARGS := --profile local-llm --profile local-embedding \
                    --profile local-docling --profile local-postgres \
                    --profile local-qdrant --profile local-object-storage \
                    --profile local-graylog

ENV_ARGS :=

ifeq ($(LLM),local)
ENV_ARGS += LLM_BASE_URL=http://llm:8080/v1 LLM_API_KEY=not-needed
endif

ifeq ($(EMBEDDING),local)
ENV_ARGS += EMBEDDING_BASE_URL=http://embedding:8000/v1 EMBEDDING_API_KEY=not-needed EMBEDDING_API_TYPE=tei
endif

ifeq ($(DOCLING),local)
ENV_ARGS += DOCLING_BASE_URL=http://docling:5001
endif

ifeq ($(POSTGRES),local)
ENV_ARGS += POSTGRES_DSN=postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres:5432/$(POSTGRES_DB)
endif

ifeq ($(QDRANT),local)
ENV_ARGS += QDRANT_URL=http://qdrant:6333 QDRANT_API_KEY=
endif

ifeq ($(OBJECT_STORAGE),local)
ENV_ARGS += OBJECT_STORAGE_PROVIDER=s3 S3_ENDPOINT_URL=http://minio:9000
else ifeq ($(OBJECT_STORAGE),filesystem)
ENV_ARGS += OBJECT_STORAGE_PROVIDER=local
endif

ifeq ($(GRAYLOG),local)
ENV_ARGS += GRAYLOG_ENABLED=true GRAYLOG_HOST=graylog GRAYLOG_PORT=12201
else
ENV_ARGS += GRAYLOG_ENABLED=false
endif

ENV_ARGS += PROMPTS_DIR=/app/prompts EMBEDDING_VECTOR_SIZE=$(EMBEDDING_VECTOR_SIZE)

help:
	@echo "Mimir — Интеллектуальная RAG-система"
	@echo ""
	@echo "make up                       — дефолтный стек (LLM/embedding=cloud, остальное=local, Graylog=on)"
	@echo "make up LLM=local             — с локальной LLM на GPU"
	@echo "make up EMBEDDING=local       — с локальными эмбеддингами на GPU"
	@echo "make up LLM=local EMBEDDING=local — полностью локальный AI на GPU"
	@echo "make up OBJECT_STORAGE=local  — с MinIO"
	@echo "make up GRAYLOG=false         — без Graylog"
	@echo "make down                     — остановить всё"
	@echo "make restart                  — перезапустить"
	@echo "make rebuild                  — пересобрать образы с нуля и перезапустить"
	@echo ""
	@echo "Флаги: LLM=local|cloud EMBEDDING=local|cloud DOCLING=local|cloud"
	@echo "       POSTGRES=local|cloud QDRANT=local|cloud"
	@echo "       OBJECT_STORAGE=filesystem|local|cloud GRAYLOG=local|false"

up:
	$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) up -d --build --remove-orphans

down:
	$(COMPOSE) -f $(COMPOSE_FILE) $(ALL_PROFILE_ARGS) down

restart:
	$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) up -d --build --force-recreate --remove-orphans

rebuild:
	$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) build --no-cache
	$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) up -d --force-recreate --remove-orphans

logs:
	$(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) logs -f

ps:
	$(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) ps

config:
	$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) config

pull:
	$(COMPOSE) -f $(COMPOSE_FILE) $(ALL_PROFILE_ARGS) pull

test:
	cd api && uv run pytest -v -s tests/

clean-db:
	docker exec mimir-postgres psql -U mimir -d mimir_db -c "DELETE FROM analysis.analysis_job_targets; DELETE FROM analysis.analysis_jobs; DELETE FROM documents.document_processing_jobs; DELETE FROM documents.document_history; DELETE FROM documents.chunks; DELETE FROM documents.documents; DELETE FROM documents.project_index_configs; DELETE FROM documents.projects;" 2>/dev/null || true
	docker exec mimir-api python -c "import httpx; r=httpx.get('http://qdrant:6333/collections'); [httpx.delete(f'http://qdrant:6333/collections/{c[\"name\"]}') for c in r.json()['result']['collections']]" 2>/dev/null || true
	docker exec mimir-api sh -c 'rm -rf /app/storage/2*' 2>/dev/null || true
	docker exec mimir-worker sh -c 'rm -rf /app/storage/2*' 2>/dev/null || true
	@echo "DBs cleared"
