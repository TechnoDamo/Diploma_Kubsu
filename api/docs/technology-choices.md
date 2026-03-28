# Technology Choices

## Overview

This document explains the backend stack chosen for the Mimir MVP and the main alternatives that were considered.

## Core Language and Runtime

### Go

Chosen because it fits the backend's actual shape:

- SQL-heavy service with explicit control over queries and transactions
- two-process modular monolith with simple deployment
- durable worker loops and external HTTP integrations
- strong standard library for HTTP, JSON, and structured logging

Alternatives considered:

- Python
  Better for experimentation, weaker fit for a disciplined long-lived API plus worker service with generated SQL and low-friction deployment.
- Node.js / TypeScript
  Viable for API-first work, but less attractive here because the database and concurrency model are central.
- Java / Kotlin
  Strong ecosystem, but too heavy for the current project size and maturity.

## HTTP Layer

### `chi`

Chosen because it is small, explicit, and composes well with plain `net/http`.

Why it fits:

- keeps routing obvious
- avoids framework lock-in
- works well with generated OpenAPI interfaces
- matches the modular-monolith goal better than a large opinionated framework

Alternatives considered:

- `gin`
  Popular and productive, but brings more framework surface than needed.
- `echo`
  Similar tradeoff to `gin`; good ergonomics, more framework-centric than necessary.
- `fiber`
  Fast, but diverges from standard library conventions more than we want.

## Configuration

### `cleanenv` + plain environment variables

Chosen because the backend needs predictable startup behavior, not a large configuration framework.

Why it fits:

- simple typed structs
- low magic
- easy local development and container deployment

Alternatives considered:

- `viper`
  Flexible, but more behavior and indirection than this backend needs.
- `koanf`
  Cleaner than `viper`, but still more generality than required for MVP.
- hand-written env parsing
  Possible, but wastes time on solved boilerplate.

## Logging

### standard `log/slog`

Chosen because it is built into Go, structured, and sufficient for MVP operations.

Why it fits:

- no external logging dependency pressure
- structured JSON output
- future-safe standard-library choice

Alternatives considered:

- `zap`
  Excellent performance, but unnecessary complexity at current scale.
- `zerolog`
  Lean and fast, but standard `slog` is now good enough.
- `logrus`
  No longer the best default choice for a new Go service.

## Database Access

### `pgx`

Chosen because PostgreSQL is central to the system and `pgx` gives the strongest native support.

Why it fits:

- first-class PostgreSQL support
- good pool management
- solid fit for worker claim queries and transaction-heavy code

Alternatives considered:

- `database/sql` with a PostgreSQL driver
  Works, but loses some PostgreSQL-specific ergonomics.
- `lib/pq`
  Mature, but `pgx` is the stronger modern default.

### `sqlc`

Chosen because the project is already SQL-first.

Why it fits:

- query logic stays explicit
- generated Go types reduce manual scan boilerplate
- works naturally with `pgx`
- aligns with the existing DBML and migration-driven schema approach

Alternatives considered:

- handwritten query layer
  Maximum control, but too much repetitive plumbing.
- `gorm`
  Too much abstraction for a schema-driven backend with non-trivial SQL.
- `ent`
  Strong tool, but code-first schema generation is the wrong center of gravity here.

## Migrations

### `goose`

Kept because it already matches the repository direction and is sufficient for the current schema lifecycle.

Alternatives considered:

- `atlas`
  Powerful, but would introduce unnecessary migration-tool churn now.
- `tern`
  Viable, but there is no strong reason to switch.
- `dbmate`
  Simpler, but less aligned with the current Go-oriented workflow.

## OpenAPI Integration

### `oapi-codegen`

Chosen to keep transport types and server contracts aligned with the OpenAPI specification.

Why it fits:

- generates Go models from the source-of-truth API contract
- supports `chi`
- reduces transport drift between docs and implementation

Alternatives considered:

- manual DTOs only
  Fast to start, but drift risk is too high.
- full generated server stack without hand-written boundaries
  Too rigid for the module-oriented architecture we want.

## Validation

### `go-playground/validator`

Chosen as a focused DTO validation layer.

Why it fits:

- widely used
- easy to add where it helps
- does not force business validation into transport code

Alternatives considered:

- manual validation everywhere
  Simple at first, but repetitive and inconsistent over time.
- `ozzo-validation`
  Reasonable alternative, but less standard for this use case.

## Background Jobs

### PostgreSQL-backed queue tables

Chosen instead of Redis, RabbitMQ, or Kafka for MVP.

Why it fits:

- durable enough for current requirements
- no extra infrastructure
- easy transactional enqueue from HTTP handlers
- works with `FOR UPDATE SKIP LOCKED`

Alternatives considered:

- in-process goroutines only
  Rejected because jobs would not be durable enough.
- Redis + `asynq`
  Good operationally, but premature extra infrastructure.
- RabbitMQ / Kafka
  Powerful, but inappropriate complexity at this stage.

## External Provider Integration

### Plain HTTP clients behind internal interfaces

Chosen for Docling, TEI, and the LLM provider layer.

Why it fits:

- provider behavior stays contained in infrastructure adapters
- future provider switching remains realistic
- avoids leaking provider SDK types into business logic

Alternatives considered:

- provider SDKs directly in modules
  Faster initially, but creates tighter coupling than we want.
