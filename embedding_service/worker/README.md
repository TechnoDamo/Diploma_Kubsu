# Worker Plane (Python)

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
