# Mimir API — Бэкенд

Python/FastAPI бэкенд RAG-системы Mimir.

## Быстрый старт

```bash
# Установка зависимостей
uv sync

# Запуск API
uv run uvicorn app.main:app --host 0.0.0.0 --port 8080

# Запуск воркера
uv run python -m app.worker.worker
```

## Docker

```bash
make up        # запуск API + воркера
make down      # остановка
make migrate   # alembic upgrade head
make test      # pytest
make lint      # ruff check
```

## Структура

```
api/
├── app/
│   ├── main.py              # FastAPI приложение, CORS, middleware
│   ├── config.py            # pydantic-settings (все переменные из .env)
│   ├── database.py          # async SQLAlchemy engine + сессии
│   ├── dependencies.py      # DI: сервисы, клиенты, БД
│   ├── routers/             # HTTP роутеры
│   │   ├── health.py        # /healthz, /healthz/live
│   │   ├── projects.py      # CRUD проектов
│   │   ├── documents.py     # CRUD документов + upload
│   │   ├── rag.py           # RAG-запросы
│   │   └── analysis.py      # Анализ противоречий
│   ├── services/            # Бизнес-логика
│   │   ├── projects.py      # Управление проектами
│   │   ├── documents.py     # Управление документами + аудит
│   │   ├── indexing.py      # Индексация: парсинг → чанки → Qdrant
│   │   ├── rag.py           # Гибридный поиск + LLM-ответ
│   │   └── analysis.py      # Поиск противоречий: Qdrant → LLM
│   ├── models/              # SQLAlchemy ORM модели
│   ├── schemas/             # Pydantic схемы запросов/ответов
│   ├── infra/               # Клиенты внешних сервисов
│   │   ├── qdrant.py        # QdrantRepository (гибридный поиск)
│   │   ├── tei.py           # TEIClient (эмбеддинги)
│   │   ├── llm.py           # LLMClient (OpenAI-compatible)
│   │   ├── docling.py       # DoclingClient (парсинг)
│   │   └── files.py         # FileStorage (файлы)
│   ├── support/             # Утилиты (chunking, реконструкция текста)
│   └── worker/              # Фоновый воркер
├── prompts/                 # Промпты на русском (4 файла)
├── tests/                   # Тесты
├── pyproject.toml
├── alembic.ini
└── Dockerfile
```

## Конфигурация

Все параметры через переменные окружения (`pydantic-settings`).
Подробный список — в `.env.example`.

## Зависимости

```toml
fastapi, uvicorn, pydantic-settings, sqlalchemy[asyncio],
asyncpg, alembic, qdrant-client[fastembed], httpx,
python-multipart, structlog, pytest, pytest-asyncio, ruff
```
