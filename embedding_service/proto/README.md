# gRPC Contracts

This directory contains all protobuf definitions shared across the platform.

It defines:

- the public Embeddings API exposed by the control plane
- the internal Worker API used between the control plane and Python workers
- shared message types and versioned schemas

This directory is the system boundary.

Both the control plane and worker services depend on these contracts. No service-specific logic lives here.
