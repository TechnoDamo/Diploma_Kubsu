# Control Plane (Go)

The control plane is the main infrastructure service of the embedding-creation platform.

It exposes a gRPC API to internal clients and is responsible for:

- request validation and normalization
- routing (local workers vs external providers)
- dynamic batching and queueing
- worker pool management
- fallback, shadowing, and routing strategies
- observability (metrics, tracing, health)
- configuration and service-level policies

This service does NOT run ML models.

It orchestrates where and how embeddings are computed, and acts as the single entry point into the platform.
