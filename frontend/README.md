# Mimir Frontend

Frontend application for the Mimir RAG system, built against the OpenAPI contract in:

- `../api-docs-swagger/specs/comparison-service.yaml`

This app is implemented to work in two modes:

- real API mode (backend at `http://localhost:8080/api/v1`)
- mock API mode (MSW in-browser simulation of all contract endpoints)

## Tech Stack

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- MSW (Mock Service Worker)

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
  - completed result rendering and failed error rendering

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

Create MSW service worker file (one-time):

```bash
npx msw init public --save
```

Or run both in one step:

```bash
make setup
```

## Run

Development with real backend:

```bash
npm run dev
```

Development with mock server in browser:

```bash
npm run mock
```

Makefile equivalents:

```bash
make dev
make mock
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

`VITE_API_BASE_URL` (optional)

- default: `http://localhost:8080/api/v1`

Example:

```bash
VITE_API_BASE_URL=http://localhost:8080/api/v1 npm run dev
```

## Mock Behavior Notes

MSW handlers simulate contract-relevant backend behavior, including:

- status transitions for document ingestion (`uploaded -> processing -> indexed/failed`)
- `/text` returning `409 DOCUMENT_NOT_READY` until document indexing completes
- realistic API errors (`404`, `409`, `413`, `415`, `422`)
- async contradiction jobs with polling lifecycle
- RAG responses with generated citations from indexed docs

## API Contract Alignment

The frontend request/response models are in:

- `src/shared/types/api.ts`

Endpoint modules:

- `src/features/projects/projects.api.ts`
- `src/features/documents/documents.api.ts`
- `src/features/rag/rag.api.ts`
- `src/features/analysis/analysis.api.ts`

## Troubleshooting

- If MSW requests are not intercepted:
  - run `npx msw init public --save` again
  - hard refresh browser after starting `npm run mock`
- If network requests bypass mocks:
  - confirm app is started with `npm run mock` (mode must be `mock`)
- If CORS errors appear in real API mode:
  - confirm backend allows `http://localhost:5173`

## Current Limitations

- No automated tests are added yet.
- OpenAPI client generation is not wired yet; current client is manually typed.
- Document content preview is currently download-first (not inline PDF renderer).
