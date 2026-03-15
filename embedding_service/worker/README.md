# Worker

This directory contains older local server code and is not the recommended deployment path.

Use the container-based setup in [embedding_service/README.md](/Users/damir/Documents/Diploma_Kubsu/embedding_service/README.md):

```bash
docker run --gpus all -p 8080:80 \
  -v $PWD/data:/data \
  --pull always \
  ghcr.io/huggingface/text-embeddings-inference:cuda-1.9-grpc \
  --model-id Qwen/Qwen3-Embedding-0.6B
```
