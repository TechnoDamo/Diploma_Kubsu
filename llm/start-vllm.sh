#!/bin/bash
set -euo pipefail

MODEL_PATH="/models/${LLM_HF_REPO:-Qwen/Qwen2.5-0.5B-Instruct}"

if [ -f "/dev/nvidiactl" ] || [ -f "/dev/nvidia0" ]; then
    echo "NVIDIA GPU detected"
else
    echo "No GPU found, running on CPU"
fi

if [ ! -f "${MODEL_PATH}/config.json" ]; then
    echo "Model not found at ${MODEL_PATH}"
    echo "Run 'make download-model' first"
    exit 1
fi

python3 -m vllm.entrypoints.openai.api_server \
    --model "${MODEL_PATH}" \
    --host 0.0.0.0 \
    --port 8080 \
    --dtype "${LLM_DTYPE:-bfloat16}" \
    --max-model-len "${LLM_CTX_SIZE:-2048}"
