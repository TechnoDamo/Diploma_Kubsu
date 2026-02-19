# Worker Plane (Python)

The worker plane runs a single embedding model and exposes it over gRPC. It is a compute service only: it loads a model, embeds text, and returns vectors. No routing or business logic lives here.

## Runtime flow
```
Entrypoint (cmd/server/main.py)
  -> gRPC server (worker/api/grpc_server.py)
  -> Embedding engine (worker/core/engine.py)
  -> Model loader (worker/models/loader.py)
  -> Pooling + normalization
```

## Configuration
Configuration is loaded from `configs/config.yaml` with env overrides. Env always wins.

- Config path: `WORKER_CONFIG_PATH` (default `configs/config.yaml`)
- Any `general` key is applied only if its `WORKER_*` env var is not set.

Example `configs/config.yaml`:
```yaml
general:
  grpc_host: localhost
  grpc_port: 50051
  grpc_max_workers: 4
  grpc_max_message_length: 104857600
  cache_dir: /models/cache
  trust_remote_code: true
  device: cuda
  dtype: float32
  max_batch_size: 32
  batch_timeout_ms: 50
  log_level: INFO
  log_format: json

models:
  default_model:
    pooling: mean
    normalization: l2
    max_sequence_length: 512
    supported_pooling:
      - mean
      - cls
      - max
    supported_normalization:
      - none
      - l2

  ai-forever/ru-en-RoSBERTa:
    pooling: mean
    normalization: l2
    max_sequence_length: 512
    supported_pooling:
      - mean
      - cls
      - max
    supported_normalization:
      - none
      - l2
```

Behavior:
- If `model_id` is not found in `models`, `default_model` is used.
- If a model is found, all its fields must be present.
- Pooling/normalization can be overridden per request if provided.

## API (gRPC)
The proto lives at `worker/v1/worker.proto`. The main RPCs are:
- `Embed` for single text
- `EmbedBatch` for batch items
- `HealthCheck`
- `GetModelInfo`

Readiness:
- `HealthCheck` returns `NOT_READY` until the model is loaded and warmup (if enabled) completes.

## Project structure
```
cmd/server/main.py           Entrypoint
worker/api/grpc_server.py    gRPC server and request handling
worker/core/engine.py        Embedding pipeline
worker/core/types.py         Internal dataclasses
worker/models/loader.py      HF model + tokenizer loading
worker/models/registry.py    Model defaults and validation
worker/pooling/base.py       Pooling strategies
worker/postprocess/normalization.py  Normalization
worker/infra/config.py       Config + env
worker/infra/logging.py      Structured logging
```

## Notes
- The worker is single-model per process. Run multiple containers for multiple models.
- `max_batch_size` and `batch_timeout_ms` are reserved for future batching logic.

## Local commands
- Run: `make run` or `scripts/run-local.sh`
- Tests: `make test`
- Regenerate proto: `make proto`

## Docker
Build and run the worker:
```
docker build -t embedding-worker .
docker run --rm -p 50051:50051 \
  -e WORKER_CONFIG_PATH=/app/configs/config.yaml \
  -e WORKER_MODEL_ID=ai-forever/ru-en-RoSBERTa \
  -e WORKER_DEVICE=cpu \
  -v "$(pwd)/configs:/app/configs" \
  -v "$(pwd)/models:/app/models" \
  embedding-worker
```

Or via compose:
```
docker compose up --build
```

## grpcui (Docker)
Run `grpcui` pointing at the worker:
```
docker run --rm -p 8080:8080 \
  fullstorydev/grpcui \
  -plaintext host.docker.internal:50051
```
