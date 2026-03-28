# Mimir Frontend

Frontend application for the Mimir RAG system, built against the OpenAPI contract in:

- `../api-docs-swagger/specs/mimir-rag-api.yaml`

This app is now **real-backend first**:

- default mode: requests go to `/api/v1` and are proxied by Vite to `http://localhost:8080`
- optional fallback mode: MSW-based browser mocks behind `VITE_ENABLE_MOCKS=true`
- in local Vite development, the recommended path is the built-in `/api` proxy to the Go backend on `http://localhost:8080`

## Tech Stack

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- MSW (optional fallback switch only)

## Implemented Features

- Project management
  - list projects
  - create project
  - delete project
- Document workflows
  - list documents by project
  - upload document (multipart/form-data)
  - document metadata/status polling
  - delete document
  - fetch extracted text (`/text`) with `409 DOCUMENT_NOT_READY` handling
  - fetch original content (`/content`) and download blob
- RAG query
  - ask question at project scope
  - optional target document selection
  - answer and citations rendering
- Contradiction analysis
  - start async job
  - job polling (`queued -> processing -> completed/failed`)
  - target-level summary rendering and failed error rendering

## Visual Direction

- black / charcoal operating-console layout
- restrained neon cyan + green accents
- real-time status emphasis for indexing and async jobs
- live-backend oriented UX with clear failure states

## Project Structure

```text
frontend/
  src/
    app/                # app bootstrap, providers, router
    features/           # API modules + query hooks by domain
      projects/
      documents/
      rag/
      analysis/
    mocks/              # MSW handlers and browser setup
    pages/              # routed screens
    shared/             # http client, types, env, UI shell
```

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

Install dependencies:

```bash
npm install
```

Optional: create an env file from the example:

```bash
cp .env.example .env
```

Mock mode only needs the service worker if you intend to use it:

```bash
npx msw init public --save
```

## Run

Development with real backend:

```bash
npm run dev
```

With the default example env, the frontend talks to `/api/v1`, and Vite proxies that to `http://localhost:8080`. This avoids browser CORS preflight issues during local development.

Development with browser mocks:

```bash
npm run mock
```

Makefile equivalents:

```bash
make dev
make mock
```

The `mock` script works because `.env.mock` sets:

```bash
VITE_ENABLE_MOCKS=true
```

Build:

```bash
npm run build
```

Type-check:

```bash
npm run typecheck
```

Makefile equivalents:

```bash
make build
make typecheck
```

Preview production build:

```bash
npm run preview
```

## Environment Variables

- `VITE_API_BASE_URL`

  - default: `/api/v1`
  - base URL for the Go backend API
  - recommended for local Vite development because `/api` is proxied to `http://localhost:8080`

- `VITE_ENABLE_MOCKS`

  - default: `false`
  - when `true`, the browser starts MSW before rendering the app

Example:

```bash
VITE_API_BASE_URL=/api/v1 npm run dev
```

If you intentionally want to bypass the Vite proxy and call the backend directly, you can still do:

```bash
VITE_API_BASE_URL=http://localhost:8080/api/v1 npm run dev
```

Enable mocks explicitly:

```bash
VITE_ENABLE_MOCKS=true npm run dev
```

## Backend Expectations

The frontend expects:

- backend HTTP API on `http://localhost:8080/api/v1`
- CORS enabled for `http://localhost:5173`
- project, document, RAG, and contradiction-analysis endpoints live
- integer IDs in route params and payloads

## Mock Behavior Notes

MSW handlers simulate contract-relevant backend behavior, including:

- status transitions for document ingestion (`uploaded -> processing -> indexed/failed`)
- `/text` returning `409 DOCUMENT_NOT_READY` until document indexing completes
- realistic API errors (`404`, `409`, `413`, `415`, `422`)
- async contradiction jobs with polling lifecycle
- RAG responses with generated citations from indexed docs
- contradiction summaries plus raw pair-level evidence

## API Contract Alignment

The frontend request/response models are in:

- `src/shared/types/api.ts`

Endpoint modules:

- `src/features/projects/projects.api.ts`
- `src/features/documents/documents.api.ts`
- `src/features/rag/rag.api.ts`
- `src/features/analysis/analysis.api.ts`

## Troubleshooting

- If CORS errors appear in real API mode:
  - confirm backend allows `http://localhost:5173`
- If document text remains unavailable:
  - check whether the backend document status is still `uploaded` / `processing`
  - if it becomes `failed`, inspect the backend worker and parser logs
- If MSW requests are not intercepted in optional mock mode:
  - run `npx msw init public --save`
  - hard refresh after starting `npm run mock`

## Current Limitations

- No dedicated component test suite exists yet.
- OpenAPI code generation is not wired into the frontend build; request/response types are maintained manually.
- Document content preview is still download-first rather than an inline renderer.
