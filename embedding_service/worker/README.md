stal l# Worker Plane (Python)

The worker plane contains the embedding model runtime.

Each worker service runs one embedding model and is responsible for:

- loading and warming up models
- tokenization and tensor preparation
- efficient batching
- inference execution (CPU/GPU)
- pooling and normalization
- returning embeddings over gRPC

Workers are compute services, not product services.

They do not handle routing, business logic, or external providers. They only know how to turn text into vectors efficiently.

# Structrue 
```
gRPC Server
   ↓
Request Router
   ↓
Batch Scheduler
   ↓
Embedding Engine
   ↓
Model Backend (Torch)
   ↓
Hardware (CPU / GPU)
```
<br>

## internal layers
Internally we have these isolated layers: <br>
**transport**   → gRPC, lifecycle <br>
**batching**    → queues, flush logic <br>
**engine**      → embedding pipeline <br>
**backend**     → torch / onnx execution <br>
**models**      → loading, warmup <br>
**infra**       → config, logging, metrics <br>

## file structure
```
worker/
├── cmd/
│   └── server/
│       └── main.py (service entrypoint)
│ 
├── worker/
│   ├── api/
│   │   └── grpc_server.py (gRPC request handling)
│   │
│   ├── core/ (worker brains)
│   │   ├── engine.py (embedding pipeline orchestrator)
│   │   ├── batcher.py (collects and groups requests)
│   │   ├── scheduler.py ()
│   │   ├── types.py (internal dataclasses)
│   │   └── exceptions.py (controlled failure types)
│   │
│   ├── backend/ (model execution layer)
│   │   ├── base.py (backend interface)
│   │   └── torch_backend.py (HuggingFace + torch implementation)
│   │
│   ├── models/ (model lifecycly management)
│   │   ├── loader.py 
│   │   ├── tokenizer.py
│   │   └── warmup.py
│   │
│   ├── pooling/ (embedding extraction logic)
│   │   ├── base.py
│   │   ├── mean.py
│   │   └── cls.py
│   │
│   ├── postprocess/ (vector post processing)
│   │   └── normalization.py
│   │
│   ├── infra/
│   │   ├── config.py
│   │   ├── logging.py
│   │   ├── metrics.py
│   │   └── health.py
│   │
│   └── __init__.py
│
├── configs/
│   └── example.yaml
│
├── tests/
│
├── Dockerfile
├── pyproject.toml (or requirements.txt)
└── README.md
```

# Tech Stack:

## Language runtime
### Python 3.11  
**Why:** Fastest CPython, improved asyncio performance, fully supported by PyTorch, HuggingFace, and gRPC.  

## ML execution layer (core)
### PyTorch (`torch`)  
**Why:** Industry standard for ML inference, best GPU support, first-class HuggingFace integration, production-proven.  

### HuggingFace Transformers (`transformers`)  
**Why:** Universal model loader, massive model zoo, standardised configs, tokenizer integration.  

### HuggingFace Tokenizers (`tokenizers`)  
**Why:** Ultra-fast Rust-based tokenizers, industry standard, integrated with Transformers.  

### NumPy (`numpy`)  
**Why:** Standard vector interchange format, required by most ML tooling and vector databases.  

## Service & concurrency layer
### gRPC (async) — `grpcio`, `grpcio-tools`  
**Why:** Fast binary RPC, strong contracts, polyglot clients, streaming support, infra-grade reliability.  

### asyncio (built-in)  
**Why:** Native concurrency, batching, background scheduling, integrates well with gRPC.  

### uvloop (optional)  
**Why:** Faster event loop, lower latency under load.  

## Operations & support

### pydantic-settings  
**Why:** Typed configuration, environment support, validation, clarity.  

### Structured logging (`structlog` / `loguru`)  
**Why:** Async-friendly, JSON logs, production hygiene.  
**Alternatives:** standard `logging` 

## Useful additions

- `orjson` – fast JSON serialization  
- `torchmetrics` – correctness and diagnostics  
- `sentencepiece` – tokenizer backend  
- `uvicorn` – optional HTTP health endpoint  



