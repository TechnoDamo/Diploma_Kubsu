# Embedding Service Platform

This service is a platform for generating text embeddings, designed as a two-plane system:

- **Control plane (Go):** infrastructure-level service responsible for API, routing, batching, and orchestration.
- **Worker plane (Python):** model execution services responsible for running embedding models efficiently.
- **Proto:** shared gRPC contracts between all services.

The system supports:
- local embedding models (via Python workers),
- external embedding providers (via API adapters),
- dynamic routing, batching, and future scalability.

