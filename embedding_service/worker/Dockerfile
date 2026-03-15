FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app
ENV PYTHONPATH=/app

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy proto file and generate gRPC code
COPY worker/v1/worker.proto ./worker/v1/
RUN python -m grpc_tools.protoc \
    -Iworker/v1 \
    --python_out=worker/v1 \
    --grpc_python_out=worker/v1 \
    --pyi_out=worker/v1 \
    worker/v1/worker.proto

# Copy source code
COPY worker/ ./worker/
COPY cmd/ ./cmd/
COPY test_client.py ./
COPY configs/ ./configs/

# Create non-root user
RUN useradd -m -u 1000 worker && chown -R worker:worker /app
USER worker

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "\
import grpc\
import sys\
sys.path.insert(0, '/app')\
try:\
    from worker.v1 import worker_pb2, worker_pb2_grpc\
    channel = grpc.insecure_channel('localhost:50051')\
    stub = worker_pb2_grpc.WorkerServiceStub(channel)\
    response = stub.HealthCheck(worker_pb2.HealthCheckRequest(), timeout=2)\
    sys.exit(0 if response.healthy else 1)\
except Exception:\
    sys.exit(1)\
"

# Expose gRPC port
EXPOSE 50051

# Run the server
CMD ["python", "cmd/server/main.py"]
