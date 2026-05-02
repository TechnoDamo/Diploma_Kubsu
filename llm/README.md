# Local LLM (vLLM)

GPU-only. Serves an OpenAI-compatible API on port `8091` (mapped to container `8080`).
Default model: `Qwen/Qwen2.5-0.5B-Instruct` (alias `qwen2.5-0.5b-instruct`).

The model snapshot is stored in `../models/<alias>` and shared with the embedding service.

## Quick start

```bash
make download-model
make up
make health
```

## Run via root

```bash
make up LLM=local    # default — vLLM container
make up LLM=cloud    # use external OpenAI-compatible API from .env
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `VLLM_IMAGE` | `vllm/vllm-openai:v0.6.3` | Container image |
| `LLM_MODEL_LOCAL` | `qwen2.5-0.5b-instruct` | Model directory alias under `LLM_MODELS_DIR` |
| `LLM_MODEL_SOURCE` | `Qwen/Qwen2.5-0.5B-Instruct` | Hugging Face repo id |
| `LLM_DTYPE` | `bfloat16` | Inference dtype |
| `LLM_CTX_SIZE` | `2048` | Max model length |
| `LLM_PORT` | `8091` | Host port |
| `LLM_MODELS_DIR` | `../models` | Shared snapshot cache |
