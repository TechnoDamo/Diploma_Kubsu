SHELL := /bin/bash

.PHONY: generate run-api run-worker test fmt docker-build docker-test docker-up docker-down docker-logs docker-smoke

generate:
	@echo "Run sqlc and oapi-codegen after installing the tools:"
	@echo "  sqlc generate"
	@echo "  oapi-codegen -config oapi-codegen.yaml ../api-docs-swagger/specs/mimir-rag-api.yaml"

run-api:
	go run ./cmd/api

run-worker:
	go run ./cmd/worker

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal ./tools

docker-build:
	docker build -t mimir-backend .

docker-test:
	docker build --target test -t mimir-backend-test .

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down -v

docker-logs:
	docker compose logs -f postgres-vector migrator api worker

docker-smoke:
	bash ./scripts/smoke_test.sh
