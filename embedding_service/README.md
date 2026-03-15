# Embedding Service

Use Hugging Face `text-embeddings-inference` as the embedding server. No local worker service is needed for deployment.

## Quick Start

```bash
model=Qwen/Qwen3-Embedding-0.6B
volume=$PWD/data

docker run --gpus all -p 8080:80 \
  -v $volume:/data \
  --pull always \
  ghcr.io/huggingface/text-embeddings-inference:cuda-1.9-grpc \
  --model-id $model
```

This starts the embeddings server in Docker and stores downloaded model files in [`embedding_service/data`](/Users/damir/Documents/Diploma_Kubsu/embedding_service/data) via the `/data` volume.

## Parameters

- `model`: Hugging Face embedding model id
- `volume`: local cache directory for model weights
- `--gpus all`: enable GPU inference
- `-p 8080:80`: expose the container on `localhost:8080`
- `cuda-1.9-grpc`: TEI image with gRPC enabled

## CPU Version

If GPU is not available, use a CPU image:

```bash
model=Qwen/Qwen3-Embedding-0.6B
volume=$PWD/data

docker run -p 8080:80 \
  -v $volume:/data \
  --pull always \
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.9-grpc \
  --model-id $model
```

## Why mount `/data`

Mounting `/data` keeps the model cache between restarts:

- first start downloads the model
- next starts are faster

## Suggested Models

- `Qwen/Qwen3-Embedding-0.6B`
- `BAAI/bge-small-en-v1.5`
- `intfloat/multilingual-e5-base`
- `ai-forever/ru-en-RoSBERTa`

## Docker Compose Example

```yaml
services:
  embeddings:
    image: ghcr.io/huggingface/text-embeddings-inference:cuda-1.9-grpc
    ports:
      - "8080:80"
    volumes:
      - ./data:/data
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    command: ["--model-id", "Qwen/Qwen3-Embedding-0.6B"]
```

Run:

```bash
docker compose up
```
