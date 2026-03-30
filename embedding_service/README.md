# Embedding Service

This repository uses Hugging Face Text Embeddings Inference (TEI) as the embedding runtime.

The backend integration is HTTP-based, not gRPC-based. The Go backend calls `POST /embed` and expects one embedding per input string. That contract is implemented in `api/internal/infra/tei/client.go`.

## Runtime Contract

The backend sends requests like:

```json
{
  "inputs": ["Hello world"],
  "dimensions": 1024
}
```

The backend currently uses TEI for two paths:

- indexing-time document chunk embeddings
- query-time RAG retrieval embeddings

The configured dimension must match the actual output size of the served model.

## Local CPU Test

```bash
model=Qwen/Qwen3-Embedding-0.6B
text-embeddings-router --model-id "$model" --port 8080
```

Example request:

```bash
curl http://localhost:8080/embed \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": ["Hello world"],
    "dimensions": 1024
  }'
```

## GPU Deployment

CUDA-backed deployment is expected to run in a container.

```bash
model=Qwen/Qwen3-Embedding-8B
volume=$PWD/data

sudo docker run \
  --gpus all \
  -p 8080:80 \
  -v "$volume:/data" \
  --pull always \
  ghcr.io/huggingface/text-embeddings-inference:cuda-1.9 \
  --model-id "$model"
```

Sharing a persistent `/data` volume avoids re-downloading weights every run.



## Integration Notes

- `TEI_BASE_URL` in the backend should point to this service
- `PROJECT_INDEX_DEFAULTS_EMBEDDING_DIMENSION` must match the model output dimensionality
- `PROJECT_INDEX_DEFAULTS_EMBEDDING_MODEL_NAME` must match a seeded row in `embeddings.embedding_models`

## References

- TEI docs: https://huggingface.co/docs/text-embeddings-inference/index
- Embed endpoint reference: https://huggingface.github.io/text-embeddings-inference/#/Text%20Embeddings%20Inference/embed
