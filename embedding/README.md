# Embedding service (TEI)

GPU-only. Serves an OpenAI-compatible embeddings API on port `8090` (mapped to container `8000`).
Default model: `BAAI/bge-small-en-v1.5` (alias `bge-small-en-v1.5`).

The model snapshot is stored in `../models/<alias>` and shared with the LLM service.

## Quick start

```bash
make download-model
make up
make health
```

## Run via root

```bash
make up EMBEDDING=local    # default — TEI container
make up EMBEDDING=cloud    # use external OpenAI-compatible API from .env
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEI_IMAGE` | `ghcr.io/huggingface/text-embeddings-inference:86-1.5` | Image (Ampere). For T4/Turing use `:turing-1.5`. |
| `EMBEDDING_MODEL_LOCAL` | `bge-small-en-v1.5` | Model directory alias under `EMBEDDING_MODELS_DIR` |
| `EMBEDDING_MODEL_SOURCE` | `BAAI/bge-small-en-v1.5` | Hugging Face repo id |
| `EMBEDDING_VECTOR_SIZE` | `384` | Vector dimension (informational) |
| `EMBEDDING_PORT` | `8090` | Host port |
| `EMBEDDING_MODELS_DIR` | `../models` | Shared snapshot cache |
