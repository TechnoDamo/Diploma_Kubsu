.PHONY: up down migrate test lint typecheck

up:
	docker compose up -d --build

down:
	docker compose down

migrate:
	alembic upgrade head

migrate-new:
	alembic revision --autogenerate -m "$(name)"

test:
	pytest

lint:
	ruff check .

typecheck:
	@echo "typecheck not configured yet"
