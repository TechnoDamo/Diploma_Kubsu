# Frontend Stack

This frontend uses a pragmatic stack optimized for a live backend contract, async job polling, and a deliberately minimal high-contrast UI.

## Core

- `React`
  Component-based UI for building the application as reusable screens and feature blocks.
- `TypeScript`
  Static typing for API payloads, component props, and frontend domain models.
- `Vite`
  Fast local development server and simple build tooling.

## Application Layer

- `React Router`
  Routing for pages such as projects list, project details, document details, and analysis results.
- `TanStack Query`
  Server-state management for fetching, caching, mutations, polling, retries, and invalidation.

## API Layer

- OpenAPI-driven frontend contracts
  The frontend should align with `api-docs-swagger/specs/mimir-rag-api.yaml`.
- Typed API client
  A small request layer will handle JSON requests, file uploads, blob downloads, and error normalization.
- `Zod` if needed
  Optional runtime validation at the API boundary if we want stricter client-side safety.

## Styling

- Global CSS design system
  A small handwritten token layer is enough for the current app and keeps the look controlled.
- Design tokens
  Shared variables for color, typography, spacing, borders, and glow treatment.

## Mocking

- `MSW`
  Optional fallback mode only, not the primary development path.

Why it still exists:

- gives a controlled fallback when backend work is unstable
- keeps the request layer decoupled from transport details
- does not define the default runtime anymore

## Architecture Direction

Recommended structure:

```text
frontend/
  src/
    app/
    shared/
    features/
    pages/
```

Principles:

- keep server state in query hooks, not global stores
- keep route state in the URL where possible
- model document processing and analysis jobs as explicit UI states
- build against the real backend contract first
- keep mocks as an opt-in switch, not the default assumption

## First Implementation Targets

1. API client and typed models
2. Projects pages
3. Documents list and upload flow
4. Document preview and extracted text states
5. RAG query interface
6. Contradiction analysis flow

## Operational Notes

- `VITE_API_BASE_URL` points the app at the Go backend.
- `VITE_ENABLE_MOCKS=true` enables MSW before React mounts.
- The frontend is intentionally typed against integer IDs and the current backend response shapes, not the old prefixed mock identifiers.
