# PostgreSQL

Relational database service for Mimir. Schema is intentionally absent — DB design is being reworked.

Container: `mimir-postgres`, port `5432`, data volume `postgres_data`.

## Run standalone

```bash
docker compose --profile local-postgres up -d
```

## Run via root

```bash
make up POSTGRES=local
make up POSTGRES=cloud   # use external DATABASE_URL from .env
```
