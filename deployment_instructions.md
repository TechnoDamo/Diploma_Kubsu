# Deployment Instructions

This document describes the exact server-side setup needed to run:

- `docling-serve` on port `5001`
- Hugging Face Text Embeddings Inference (TEI) with GPU on port `8080`

The instructions below are written for the current target VM:

- host: `vm-5054.user-project-2032.cloud.intcld.ru`
- OS: Ubuntu 24.04 LTS
- GPU: NVIDIA GeForce RTX 3090

## 1. Connect to the server

```bash
ssh root@vm-5054.user-project-2032.cloud.intcld.ru
```

## 2. Fix apt source noise if needed

On this VM, `/etc/apt/sources.list` is active and `/etc/apt/sources.list.d/ubuntu.sources` is a broken commented file that causes apt warnings. If that warning is present, disable the broken file:

```bash
cp /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak
mv /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.disabled
apt-get update
```

## 3. Install Docker

```bash
apt-get install -y docker.io curl ca-certificates gnupg
systemctl enable --now docker
docker --version
```

Expected result:

- Docker is installed
- `systemctl is-active docker` returns `active`

## 4. Install NVIDIA Container Toolkit

Add the repository and install the toolkit:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  > /etc/apt/sources.list.d/nvidia-container-toolkit.list

apt-get update
apt-get install -y --allow-change-held-packages \
  libnvidia-container1=1.19.0-1 \
  libnvidia-container-tools=1.19.0-1 \
  nvidia-container-toolkit-base=1.19.0-1 \
  nvidia-container-toolkit=1.19.0-1

nvidia-ctk runtime configure --runtime=docker
systemctl restart docker
```

## 5. Verify GPU access from Docker

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

Expected result:

- the command prints the GPU table from inside the container
- no `could not select device driver "" with capabilities: [[gpu]]` error

## 6. Start Docling

Run Docling with restart policy and exposed UI:

```bash
docker rm -f docling-serve >/dev/null 2>&1 || true

docker run -d \
  --gpus all \
  --name docling-serve \
  --restart unless-stopped \
  -p 5001:5001 \
  -e DOCLING_SERVE_ENABLE_UI=1 \
  quay.io/docling-project/docling-serve
```

Notes:

- `--gpus all` is included so the container can use the GPU if the image/runtime path supports it.
- UI is enabled with `DOCLING_SERVE_ENABLE_UI=1`.

## 7. Start TEI

Use `BAAI/bge-m3` and keep model files in a persistent host directory:

```bash
mkdir -p /opt/tei-data

model=BAAI/bge-m3
volume=/opt/tei-data

docker rm -f tei-bge-m3 >/dev/null 2>&1 || true

docker run -d \
  --gpus all \
  --name tei-qwen3-4b \
  --restart unless-stopped \
  -p 8081:80 \
  -v /opt/tei-data:/data \
  ghcr.io/huggingface/text-embeddings-inference:cuda-1.9 \
  --model-id Qwen/Qwen3-Embedding-4B \
  --dtype float16 \
  --pooling mean \
  --max-batch-tokens 40960 \
  --max-batch-requests 320 \
  --max-client-batch-size 320 \
  --max-concurrent-requests 2048 \
  --tokenization-workers 16 \
  --auto-truncate false
```

Why `/opt/tei-data`:

- it persists downloaded weights across container restarts
- it avoids redownloading the model every time TEI is recreated

## 8. Verify containers are running

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Expected containers:

- `docling-serve`
- `tei-bge-m3`

## 9. Verify Docling

Check logs:

```bash
docker logs --tail 100 docling-serve
```

Check that the port is open:

```bash
curl -I http://localhost:5001
```

If the UI is enabled, it should also be reachable in a browser at:

- `http://<server-ip>:5001`

## 10. Verify TEI

Check logs:

```bash
docker logs --tail 100 tei-bge-m3
```

Test an embedding request:

```bash
curl http://localhost:8080/embed \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": "Hello world",
    "dimensions": 1024
  }'
```

Expected result:

- JSON array of embedding values

## 11. Useful operations

Restart both services:

```bash
docker restart docling-serve tei-bge-m3
```

Stop both services:

```bash
docker stop docling-serve tei-bge-m3
```

Remove both services:

```bash
docker rm -f docling-serve tei-bge-m3
```

Follow logs:

```bash
docker logs -f docling-serve
docker logs -f tei-bge-m3
```

## 12. Important operational notes

- The VM currently reports `*** System restart required ***` after package updates.
- GPU containers can still work without an immediate reboot if `nvidia-smi` and the Docker GPU test already work.
- If GPU containers stop working after future driver/kernel updates, reboot the VM and retest:

```bash
reboot
```

- If `apt-get` is blocked by `unattended-upgrades`, stop the background upgrader before continuing:

```bash
systemctl stop unattended-upgrades.service apt-daily.service apt-daily-upgrade.service apt-daily.timer apt-daily-upgrade.timer
```

## 13. Final expected public endpoints

- Docling: `http://<server-ip>:5001`
- TEI embed endpoint: `http://<server-ip>:8080/embed`

