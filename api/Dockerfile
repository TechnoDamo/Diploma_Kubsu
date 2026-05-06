FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

RUN apt-get update -y && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml ./
RUN uv sync --no-dev

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY prompts ./prompts

RUN mkdir -p /app/storage

EXPOSE 8080

CMD ["sh", "-c", "DB_URL=$(echo $POSTGRES_DSN | sed 's|^postgres://|postgresql+asyncpg://|') alembic -x sqlalchemy.url=$DB_URL upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8080"]
