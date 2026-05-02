.PHONY: help up down logs logs-graylog ps config pull restart \
        ai-deployment-tools-setup \
        download-llm-model download-embedding-model \
        check-llm-model check-embedding-model \
        up-local up-cloud up-local-infra up-minio up-graylog

COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.yml

LLM ?= local
EMBEDDING ?= local
POSTGRES ?= local
QDRANT ?= local
OBJECT_STORAGE ?= filesystem
GRAYLOG ?= false
DOCLING ?= local

LOAD_ENV := set -a; \
	if [ -f ./.env ]; then . ./.env; fi; \
	set +a;

PROFILE_ARGS :=
PROFILE_ARGS += $(if $(filter local,$(LLM)),--profile local-llm,)
PROFILE_ARGS += $(if $(filter local,$(EMBEDDING)),--profile local-embedding,)
PROFILE_ARGS += $(if $(filter local,$(POSTGRES)),--profile local-postgres,)
PROFILE_ARGS += $(if $(filter local,$(QDRANT)),--profile local-qdrant,)
PROFILE_ARGS += $(if $(filter local,$(OBJECT_STORAGE)),--profile local-object-storage,)
PROFILE_ARGS += $(if $(filter local,$(GRAYLOG)),--profile local-graylog,)
PROFILE_ARGS += $(if $(filter local,$(DOCLING)),--profile local-docling,)

ALL_PROFILE_ARGS := --profile local-llm --profile local-embedding \
                    --profile local-postgres --profile local-qdrant \
                    --profile local-object-storage --profile local-graylog \
                    --profile local-docling

ENV_ARGS :=

ifeq ($(POSTGRES),local)
ENV_ARGS += DATABASE_URL=postgresql+asyncpg://$${POSTGRES_USER:-mimir}:$${POSTGRES_PASSWORD:-mimir}@postgres:5432/$${POSTGRES_DB:-mimir}
else ifeq ($(POSTGRES),cloud)
ENV_ARGS += DATABASE_URL=$${DATABASE_URL}
else
$(error Unsupported POSTGRES=$(POSTGRES). Use one of: local, cloud)
endif

ifeq ($(QDRANT),local)
ENV_ARGS += VECTOR_STORE_PROVIDER=qdrant
ENV_ARGS += QDRANT_URL=http://qdrant:6333
ENV_ARGS += QDRANT_API_KEY=$${QDRANT_API_KEY:-}
else ifeq ($(QDRANT),cloud)
ENV_ARGS += VECTOR_STORE_PROVIDER=qdrant
ENV_ARGS += QDRANT_URL=$${QDRANT_URL}
ENV_ARGS += QDRANT_API_KEY=$${QDRANT_API_KEY:-}
else
$(error Unsupported QDRANT=$(QDRANT). Use one of: local, cloud)
endif

ifeq ($(OBJECT_STORAGE),filesystem)
ENV_ARGS += OBJECT_STORAGE_PROVIDER=local
ENV_ARGS += OBJECT_STORAGE_LOCAL_PATH=$${OBJECT_STORAGE_LOCAL_PATH:-/app/storage}
else ifeq ($(OBJECT_STORAGE),local)
ENV_ARGS += OBJECT_STORAGE_PROVIDER=s3
ENV_ARGS += S3_BUCKET=$${S3_BUCKET:-mimir}
ENV_ARGS += S3_REGION=$${S3_REGION:-us-east-1}
ENV_ARGS += S3_ENDPOINT_URL=$${S3_ENDPOINT_URL:-http://minio:9000}
ENV_ARGS += S3_ACCESS_KEY_ID=$${S3_ACCESS_KEY_ID:-$${MINIO_ROOT_USER:-mimir}}
ENV_ARGS += S3_SECRET_ACCESS_KEY=$${S3_SECRET_ACCESS_KEY:-$${MINIO_ROOT_PASSWORD:-mimirminio123}}
else ifeq ($(OBJECT_STORAGE),cloud)
ENV_ARGS += OBJECT_STORAGE_PROVIDER=s3
ENV_ARGS += S3_BUCKET=$${S3_BUCKET}
ENV_ARGS += S3_REGION=$${S3_REGION:-us-east-1}
ENV_ARGS += S3_ENDPOINT_URL=$${S3_ENDPOINT_URL:-}
ENV_ARGS += S3_ACCESS_KEY_ID=$${S3_ACCESS_KEY_ID}
ENV_ARGS += S3_SECRET_ACCESS_KEY=$${S3_SECRET_ACCESS_KEY}
else
$(error Unsupported OBJECT_STORAGE=$(OBJECT_STORAGE). Use one of: filesystem, local, cloud)
endif

ifeq ($(LLM),local)
ENV_ARGS += LLM_PROVIDER=openai_compatible
ENV_ARGS += LLM_BASE_URL=http://llm:8080/v1
ENV_ARGS += LLM_MODEL=$${LLM_MODEL_LOCAL:-qwen2.5-0.5b-instruct}
else ifeq ($(LLM),cloud)
ENV_ARGS += LLM_PROVIDER=$${LLM_PROVIDER:-openai_compatible}
ENV_ARGS += LLM_BASE_URL=$${LLM_BASE_URL:-https://api.openai.com/v1}
ENV_ARGS += LLM_API_KEY=$${LLM_API_KEY:-$${OPENAI_API_KEY:-}}
ENV_ARGS += LLM_MODEL=$${LLM_MODEL:-gpt-4o-mini}
else
$(error Unsupported LLM=$(LLM). Use one of: local, cloud)
endif

ifeq ($(EMBEDDING),local)
ENV_ARGS += TEI_IMAGE=ghcr.io/huggingface/text-embeddings-inference:86-1.5
ENV_ARGS += EMBEDDING_PROVIDER=openai_compatible
ENV_ARGS += EMBEDDING_BASE_URL=http://embedding:8000/v1
ENV_ARGS += EMBEDDING_MODEL=$${EMBEDDING_MODEL_LOCAL:-bge-small-en-v1.5}
else ifeq ($(EMBEDDING),cloud)
ENV_ARGS += EMBEDDING_PROVIDER=$${EMBEDDING_PROVIDER:-openai_compatible}
ENV_ARGS += EMBEDDING_BASE_URL=$${EMBEDDING_BASE_URL:-https://api.openai.com/v1}
ENV_ARGS += EMBEDDING_API_KEY=$${EMBEDDING_API_KEY:-$${OPENAI_API_KEY:-}}
ENV_ARGS += EMBEDDING_MODEL=$${EMBEDDING_MODEL:-text-embedding-3-small}
else
$(error Unsupported EMBEDDING=$(EMBEDDING). Use one of: local, cloud)
endif

ifeq ($(DOCLING),local)
ENV_ARGS += DOCLING_BASE_URL=http://docling:5001
else ifeq ($(DOCLING),cloud)
ENV_ARGS += DOCLING_BASE_URL=$${DOCLING_BASE_URL}
else
$(error Unsupported DOCLING=$(DOCLING). Use one of: local, cloud)
endif

ifeq ($(GRAYLOG),local)
ENV_ARGS += GRAYLOG_ENABLED=true
ENV_ARGS += GRAYLOG_HOST=graylog
ENV_ARGS += GRAYLOG_PORT=12201
ENV_ARGS += GRAYLOG_PROTOCOL=tcp
else ifeq ($(GRAYLOG),false)
ENV_ARGS += GRAYLOG_ENABLED=false
else
$(error Unsupported GRAYLOG=$(GRAYLOG). Use one of: local, false)
endif

help:
	@echo "Mimir root commands:"
	@echo "  make up                                  — default local stack: postgres, qdrant, vLLM, TEI, docling, filesystem storage"
	@echo "  make up LLM=cloud EMBEDDING=cloud        — use cloud AI APIs"
	@echo "  make up POSTGRES=cloud QDRANT=cloud      — use external database / vector services"
	@echo "  make up OBJECT_STORAGE=local             — start local MinIO and connect backend to it"
	@echo "  make up OBJECT_STORAGE=cloud             — use S3 credentials from .env"
	@echo "  make up DOCLING=cloud                    — use external Docling instance"
	@echo "  make up GRAYLOG=local                    — start Graylog stack and enable GELF logging"
	@echo "  make down                                — stop all profiles"
	@echo "  make logs | make ps | make config | make pull | make restart"
	@echo ""
	@echo "Flags:"
	@echo "  LLM: local | cloud                       default: local"
	@echo "  EMBEDDING: local | cloud                 default: local"
	@echo "  POSTGRES: local | cloud                  default: local"
	@echo "  QDRANT: local | cloud                    default: local"
	@echo "  OBJECT_STORAGE: filesystem | local | cloud  default: filesystem"
	@echo "  DOCLING: local | cloud                   default: local"
	@echo "  GRAYLOG: local | false                   default: false"
	@echo ""
	@echo "Setup:"
	@echo "  make ai-deployment-tools-setup           — install Docker, NVIDIA toolkit, uv, hf CLI on Linux GPU host"
	@echo "  make download-llm-model                  — download HF snapshot for vLLM"
	@echo "  make download-embedding-model            — download HF snapshot for TEI"

up:
ifeq ($(LLM),local)
	@$(MAKE) check-llm-model
endif
ifeq ($(EMBEDDING),local)
	@$(MAKE) check-embedding-model
endif
	@$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) up -d --build --remove-orphans

down:
	@$(LOAD_ENV) $(COMPOSE) -f $(COMPOSE_FILE) $(ALL_PROFILE_ARGS) down

logs:
	@$(LOAD_ENV) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) logs -f

logs-graylog:
	@$(LOAD_ENV) $(COMPOSE) -f $(COMPOSE_FILE) --profile local-graylog logs -f graylog mongodb elasticsearch

ps:
	@$(LOAD_ENV) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) ps

config:
	@$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) config

pull:
	@$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) pull

restart:
ifeq ($(LLM),local)
	@$(MAKE) check-llm-model
endif
ifeq ($(EMBEDDING),local)
	@$(MAKE) check-embedding-model
endif
	@$(LOAD_ENV) env $(ENV_ARGS) $(COMPOSE) -f $(COMPOSE_FILE) $(PROFILE_ARGS) up -d --build --force-recreate --remove-orphans

ai-deployment-tools-setup:
	@sh ./scripts/setup-ai-deployment.sh

download-llm-model:
	@$(MAKE) -C llm download-model

download-embedding-model:
	@$(MAKE) -C embedding download-model

check-llm-model:
	@$(MAKE) -C llm check-model

check-embedding-model:
	@$(MAKE) -C embedding check-model

up-local:
	@$(MAKE) up

up-cloud:
	@$(MAKE) up LLM=cloud EMBEDDING=cloud POSTGRES=cloud QDRANT=cloud OBJECT_STORAGE=cloud DOCLING=cloud

up-local-infra:
	@$(MAKE) up LLM=cloud EMBEDDING=cloud POSTGRES=local QDRANT=local OBJECT_STORAGE=filesystem DOCLING=local

up-minio:
	@$(MAKE) up OBJECT_STORAGE=local

up-graylog:
	@$(MAKE) up GRAYLOG=local
