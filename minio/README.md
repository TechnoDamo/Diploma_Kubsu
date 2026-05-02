# MinIO

S3-compatible object storage for original documents and derived artifacts.

Container: `mimir-minio`, S3 API port `9000`, console port `9001`, data volume `minio_data`.
A bootstrap container `mimir-minio-init` creates the bucket and sets it private.

## Run standalone

```bash
docker compose --profile local-object-storage up -d
```

## Run via root

```bash
make up OBJECT_STORAGE=filesystem   # default — backend writes to ./storage
make up OBJECT_STORAGE=local        # MinIO + S3 client
make up OBJECT_STORAGE=cloud        # external S3 credentials from .env
```

Console: http://localhost:9001 (login from `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`).
