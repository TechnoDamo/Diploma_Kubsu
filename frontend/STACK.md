# Frontend Stack

This frontend will be built with a pragmatic stack optimized for a typed API contract, mock-server development, and incremental UI growth.

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
  The frontend should align with `api-docs-swagger/specs/comparison-service.yaml`.
- Typed API client
  A small request layer will handle JSON requests, file uploads, blob downloads, and error normalization.
- `Zod` if needed
  Optional runtime validation at the API boundary if we want stricter client-side safety.

## Styling

- `CSS Modules`
  Scoped styles without the overhead or visual drift that often comes with utility-first defaults.
- Design tokens
  Shared variables for spacing, color, typography, borders, and layout rhythm.

## Mocking

- `MSW`
  Mock Service Worker for realistic frontend development before the backend is ready.

Why `MSW`:

- lets the frontend behave as if it is calling a real backend
- supports dynamic scenarios like polling, delayed processing, and error states
- can later be replaced without rewriting UI code

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
- build against the mock server exactly as if it were production

## First Implementation Targets

1. API client and typed models
2. Projects pages
3. Documents list and upload flow
4. Document preview and extracted text states
5. RAG query interface
6. Contradiction analysis flow
