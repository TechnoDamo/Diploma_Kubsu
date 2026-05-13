# Mimir API

`api/` содержит FastAPI-приложение и фоновый worker. API принимает HTTP-запросы,
сохраняет документы и создаёт задания, а worker выполняет долгие операции:
индексацию документов и анализ противоречий.

## Запуск локально без Docker

Такой режим удобен для разработки backend-кода. Для полноценной работы всё равно
нужны PostgreSQL, Qdrant, embedding API и LLM API.

```bash
uv sync

# API
uv run uvicorn app.main:app --host 0.0.0.0 --port 8080

# Worker, в отдельном терминале
uv run python -m app.worker.worker
```

## Запуск через Docker

Обычно backend запускают из корня репозитория:

```bash
make up
```

Внутри папки `api/` есть локальный Makefile для изолированных backend-команд:

```bash
make up        # поднять api + worker из api/docker-compose.yaml
make down      # остановить локальный compose
make migrate   # alembic upgrade head
make test      # pytest
make lint      # ruff check .
```

## Основные модули

```text
api/
├── app/
│   ├── main.py              # FastAPI app, CORS, request logging
│   ├── config.py            # pydantic-settings, env-переменные
│   ├── database.py          # async SQLAlchemy engine и session factory
│   ├── dependencies.py      # создание сервисов и клиентов
│   ├── routers/             # HTTP endpoint'ы
│   │   ├── health.py        # /healthz, /healthz/ready, /healthz/live
│   │   ├── projects.py      # проекты
│   │   ├── documents.py     # документы, upload, text/content
│   │   ├── rag.py           # вопросы по документам
│   │   └── analysis.py      # задачи анализа противоречий
│   ├── services/            # бизнес-логика
│   │   ├── projects.py      # CRUD проектов
│   │   ├── documents.py     # сохранение файлов, статусы, история
│   │   ├── indexing.py      # parse -> chunk -> embed -> Qdrant
│   │   ├── rag.py           # retrieval + генерация ответа
│   │   └── analysis.py      # подбор кандидатов + LLM-проверка
│   ├── infra/               # клиенты внешних систем
│   │   ├── qdrant.py        # QdrantRepository
│   │   ├── tei.py           # embedding client
│   │   ├── llm.py           # OpenAI-compatible LLM client
│   │   ├── docling.py       # Docling client
│   │   └── files.py         # local/S3-compatible file storage
│   ├── schemas/             # Pydantic-схемы запросов и ответов
│   ├── support/             # chunking, sparse-векторы, retry, logging
│   └── worker/              # фоновый процесс
├── prompts/                 # промпты для RAG и анализа
├── tests/                   # интеграционные тесты
├── alembic/                 # миграции БД
├── pyproject.toml
├── uv.lock
└── Dockerfile
```

## Потоки данных

### Загрузка и индексация

1. `POST /api/v1/projects/{project_id}/documents` принимает файл.
2. `DocumentService` сохраняет оригинал и создаёт запись документа.
3. В таблицу `documents.document_processing_jobs` добавляется задача.
4. Worker берёт первую задачу со статусом `queued`.
5. `IndexingService` извлекает текст, режет его на чанки, строит embeddings,
   сохраняет чанки в PostgreSQL и векторы в Qdrant.
6. Документ получает статус `indexed` или `failed`.

Чанкинг использует активную конфигурацию индекса проекта: `chunk_size`,
`chunk_overlap` и `chunk_unit` (`characters` по умолчанию). Границы чанков
подбираются по предложениям в best-effort режиме: конец чанка и начало
следующего чанка не режут предложение, если подходящая граница находится рядом
с целевым размером/overlap. Если ближайшая граница слишком далеко, применяется
жёсткий fallback по размеру чанка, чтобы не создавать чрезмерно большие чанки.
В Qdrant payload сохраняются `chunk_order`, `char_start`, `char_end`,
`char_count`, полный `text` и `text_preview`.

### RAG

1. `RAGService` векторизует вопрос.
2. Qdrant возвращает релевантные чанки.
3. Сервис собирает контекст и отправляет его в LLM.
4. Ответ возвращается синхронно вместе с цитатами.

RAG retrieval использует веса из активной конфигурации проекта
`rag_dense_weight` / `rag_sparse_weight`, а при отсутствии значений берёт
env defaults `RAG_DENSE_WEIGHT` / `RAG_SPARSE_WEIGHT`. Если оба веса больше
нуля и sparse-вектор доступен, API выполняет один Qdrant `query_points` запрос
с `prefetch` для dense и sparse веток и weighted `RrfQuery`, куда передаются
эти веса. Если один из весов равен нулю, соответствующая ветка отключается и
используется dense-only или sparse-only retrieval.

### Противоречия

1. `POST /api/v1/projects/{project_id}/analysis/contradictions` создаёт
   асинхронную задачу в `analysis.analysis_jobs`.
2. Если `target_document_ids` не переданы, target-ами становятся все остальные
   `indexed` документы проекта.
3. Worker берёт чанки базового документа и ищет похожие чанки в каждом target
   документе через hybrid retrieval.
4. LLM проверяет пары фрагментов и формирует структурированный результат.
5. Найденные противоречия группируются по target-документам, суммаризируются и
   сохраняются в `analysis.analysis_jobs.results`.
6. Статус и результат доступны через
   `GET /api/v1/projects/{project_id}/analysis/contradictions/{job_id}`.

Для анализа противоречий используются `contradiction_dense_weight` /
`contradiction_sparse_weight` из активной конфигурации проекта или env defaults
`CONTRADICTION_DENSE_WEIGHT` / `CONTRADICTION_SPARSE_WEIGHT`. Dense-часть ищет
похожие чанки через Qdrant `RecommendQuery` по point id базового чанка.
Sparse-часть строит BM25-вектор по тексту базового чанка и ищет по sparse
вектору. Когда обе ветки включены, они передаются в Qdrant как `prefetch`, а
итоговый список формируется встроенным weighted `RrfQuery`. Числовые веса
передаются в Qdrant как RRF weights; `dense_weight <= 0` отключает dense,
`sparse_weight <= 0` отключает sparse. В hybrid-режиме fusion выполняет Qdrant
backend.
`contradiction_max_distance` применяется к итоговой дистанции `1 - score`.

### Прямые проверки Qdrant retrieval

Для проверки retrieval через API без LLM есть отдельный endpoint:

```bash
curl -fsS -X POST "http://localhost:8080/api/v1/projects/166/retrieval/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "срок выплаты заработной платы",
    "target_document_ids": [381],
    "dense_weight": 0.7,
    "sparse_weight": 0.3,
    "limit": 5,
    "include_text": true,
    "include_payload": true
  }'
```

Ответ содержит имя Qdrant collection, фактически выбранный режим retrieval
(`dense`, `sparse` или `hybrid`) и массив `points` со score/distance,
`document_id`, `chunk_id`, `chunk_order`, символьными границами, preview, text
и raw payload. Чтобы проверить dense-only, передайте `"sparse_weight": 0`.
Чтобы проверить sparse-only, передайте `"dense_weight": 0`.

Ниже примеры для локального Qdrant. Замените `PROJECT_ID`, `DOCUMENT_ID`,
`TARGET_DOCUMENT_ID`, `COLLECTION`, `POINT_ID` и sparse-вектор на значения из
вашей коллекции.

Получить первые points документа:

```bash
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/scroll" \
  -H 'Content-Type: application/json' \
  -d '{
    "filter": {
      "must": [
        {"key": "project_id", "match": {"value": 166}},
        {"key": "document_id", "match": {"value": 379}}
      ]
    },
    "order_by": {"key": "chunk_id", "direction": "asc"},
    "limit": 5,
    "with_payload": true,
    "with_vector": true
  }'
```

Dense recommend search от существующего point:

```bash
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"recommend": {"positive": ["POINT_ID"]}},
    "using": "dense",
    "filter": {"must": [{"key": "document_id", "match": {"value": 381}}]},
    "limit": 5,
    "with_payload": true
  }'
```

Sparse search по BM25 sparse-вектору:

```bash
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"indices": [100, 200], "values": [1.0, 0.7]},
    "using": "sparse",
    "filter": {"must": [{"key": "document_id", "match": {"value": 381}}]},
    "limit": 5,
    "with_payload": true
  }'
```

Raw Qdrant hybrid fusion для проверки самой коллекции:

```bash
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "prefetch": [
      {
        "query": {"recommend": {"positive": ["POINT_ID"]}},
        "using": "dense",
        "limit": 20
      },
      {
        "query": {"indices": [100, 200], "values": [1.0, 0.7]},
        "using": "sparse",
        "limit": 20
      }
    ],
    "query": {"rrf": {"weights": [0.7, 0.3]}},
    "filter": {"must": [{"key": "document_id", "match": {"value": 381}}]},
    "limit": 5,
    "with_payload": true
  }'
```

Важно: последний пример повторяет hybrid-путь Mimir на уровне Qdrant. Весовые
настройки Mimir (`*_dense_weight` / `*_sparse_weight`) передаются как массив
`rrf.weights` в том же порядке, что и `prefetch`: dense затем sparse. Для этого
локальный Qdrant должен быть версии `1.17.0` или новее.

## Переменные окружения, на которые стоит смотреть первыми

| Переменная | Зачем нужна |
|------------|-------------|
| `POSTGRES_DSN` | Подключение к PostgreSQL. |
| `QDRANT_URL` | Адрес Qdrant. |
| `EMBEDDING_BASE_URL` | Адрес embedding API или TEI. |
| `EMBEDDING_API_TYPE` | `openai_compatible` или `tei`. |
| `PROJECT_INDEX_DEFAULTS_EMBEDDING_DIMENSION` | Размерность векторов; должна совпадать с моделью. |
| `RAG_DENSE_WEIGHT`, `RAG_SPARSE_WEIGHT` | Веса dense/sparse веток для RAG, если в конфигурации проекта нет своих значений; оба значения больше нуля включают Qdrant weighted RRF. |
| `CONTRADICTION_DENSE_WEIGHT`, `CONTRADICTION_SPARSE_WEIGHT` | Веса dense/sparse веток для анализа противоречий; оба значения больше нуля включают Qdrant weighted RRF. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | OpenAI-compatible LLM для RAG и анализа. |
| `USE_DOCLING` | `true` для Docling, `false` для Python fallback-парсинга. |
| `UPLOAD_MAX_SIZE_MB` | Максимальный размер загружаемого файла. |
| `WORKER_POLL_INTERVAL_SECONDS` | Частота опроса очереди worker'ом. |

Полный список находится в корневом `.env.example`.

## Интеграционный тест

```bash
# из корня репозитория
make up

# затем
cd api
uv run pytest -v -s tests/
```

Тест создаёт проект, загружает документы из `api/scripts/test_docs`, ждёт индексации,
делает RAG-запрос и запускает анализ противоречий. Если тест зависает на статусе
`uploaded`, сначала проверьте логи `mimir-worker`: чаще всего worker занят старой
задачей или не может достучаться до embedding/LLM сервиса.

## Диагностика

```bash
# API жив
curl -s http://localhost:8080/healthz

# Глубокая проверка зависимостей
curl -s http://localhost:8080/healthz/live

# Состояние документов проекта
curl -s 'http://localhost:8080/api/v1/projects/1/documents?limit=100'

# Логи worker из корня репозитория
docker logs --tail 100 mimir-worker
```
