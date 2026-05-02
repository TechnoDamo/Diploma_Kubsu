# Qdrant

Vector store for Mimir's RAG retrieval and contradiction search.

Container: `mimir-qdrant`, REST port `6333`, data volume `qdrant_data`.

## Run standalone

```bash
docker compose --profile local-qdrant up -d
```

## Run via root

```bash
make up QDRANT=local
make up QDRANT=cloud   # use external QDRANT_URL / QDRANT_API_KEY from .env
```
