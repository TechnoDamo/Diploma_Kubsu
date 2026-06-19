#!/bin/bash
set -euo pipefail

echo "=== Smart Support — AI Deployment Setup ==="
echo "Target: Ubuntu 22.04/24.04 with NVIDIA GPU"
echo ""

if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root (sudo)."
    exit 1
fi

echo "Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

echo "Installing NVIDIA Container Toolkit..."
if ! command -v nvidia-ctk &>/dev/null; then
    distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    apt-get update
    apt-get install -y nvidia-container-toolkit
    nvidia-ctk runtime configure --runtime=docker
    systemctl restart docker
fi

echo "Verifying GPU access inside Docker..."
docker run --rm --gpus all ubuntu nvidia-smi || echo "WARNING: GPU container test failed"

echo "Installing uv..."
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi

echo "Installing huggingface_hub CLI..."
python3 -m venv /opt/hf-venv
/opt/hf-venv/bin/pip install huggingface_hub

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Set HUGGING_FACE_HUB_TOKEN in .env"
echo "  2. make download-llm-model && make download-embedding-model"
echo "  3. make up"
