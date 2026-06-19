# RAG System — RAG-система для анализа документов

RAG System — дипломный проект: система для загрузки документов, семантического поиска по ним,
ответов на вопросы с цитатами и поиска противоречий между документами. Проект ориентирован
на локальный запуск через Docker Compose, но LLM и сервис эмбеддингов можно заменить
облачными OpenAI-compatible API.

## Что умеет система

- Создавать проекты, то есть отдельные базы знаний.
- Загружать документы форматов `PDF`, `DOCX`, `TXT`, `MD`, `HTML`.
- Извлекать текст, нарезать его на чанки и индексировать в Qdrant.
- Искать по документам гибридно: dense-векторы + sparse/BM25.
- Отвечать на вопросы по базе знаний с привязкой ответа к найденным фрагментам.
- Запускать фоновый анализ противоречий между базовым и целевыми документами.
- Хранить метаданные, статусы задач и историю операций в PostgreSQL.

Типовые сценарии: проверка внутренних регламентов, договоров, юридических текстов,
инструкций, политик безопасности и других наборов документов, где важно быстро найти
ответ или конфликтующее утверждение.

## Быстрый старт

Перед запуском нужен Docker/Colima или Docker Desktop. Фронтенд в корневой compose
не включён: его удобнее запускать локально из папки `frontend`.

```bash
# 1. Поднять backend-стек: API, worker, Postgres, Qdrant, Docling, Graylog
make up

# 2. Запустить frontend в отдельном терминале
cd frontend
npm install
npm run dev
```

Адреса по умолчанию:

| Сервис | URL |
|--------|-----|
| Frontend | `http://localhost:3000` |
| API | `http://localhost:8080` |
| Healthcheck | `http://localhost:8080/healthz` |
| Qdrant | `http://localhost:6333` |
| Docling | `http://localhost:5001` |
| Graylog | `http://localhost:19000` (`admin` / `admin`) |

Для быстрой ежедневной работы без Graylog:

```bash
make fast-up
```

## Команды Makefile

Главное правило: `make up` запускает стек, а сборку стоит запускать явно только тогда,
когда менялись Dockerfile, зависимости или образ ещё не создан.

| Команда | Что делает | Когда использовать | Ориентир по времени |
|---------|------------|--------------------|---------------------|
| `make up` | Запускает backend-стек. Если образ `rag-system-api:local` отсутствует, сначала собирает его. | Обычный запуск. | Первый запуск: минуты; повторно: 5-30 секунд. |
| `make fast-up` | Запускает backend-стек без Graylog. | Локальная разработка и демонстрация без лог-агрегатора. | Обычно быстрее `make up`. |
| `make up-build` | Запускает стек с `docker compose up --build`. | После изменения `api/Dockerfile`, `api/pyproject.toml`, `api/uv.lock` или compose-настроек. | 20-90 секунд с тёплым кешем, дольше при скачивании зависимостей. |
| `make build` | Собирает только API-образ, контейнеры не запускает. | Проверить сборку отдельно от запуска. | Как `up-build`, но без старта сервисов. |
| `make restart` | Быстро перезапускает уже созданные контейнеры. | Когда нужно перечитать процесс без пересоздания контейнера. | 2-10 секунд. |
| `make recreate` | Пересоздаёт контейнеры из существующих образов. | После изменения env-переменных, портов или volumes. | 10-40 секунд. |
| `make rebuild` | Полная сборка API без кеша и пересоздание контейнеров. | Только если кеш действительно мешает или нужна чистая сборка. | Самая долгая команда, часто несколько минут. |
| `make down` | Останавливает и удаляет контейнеры. Named volumes с данными сохраняются. | Остановить проект. | 5-20 секунд. |
| `make logs` | Показывает логи выбранного профилями стека. | Диагностика worker/API/Graylog. | Пока не остановить `Ctrl+C`. |
| `make ps` | Показывает состояние контейнеров. | Быстрая проверка, что поднялось. | Секунды. |
| `make config` | Выводит итоговый Docker Compose config с учётом профилей и `.env`. | Проверить, какие сервисы реально попадут в запуск. | Секунды. |

Примеры профилей:

```bash
# Локальная LLM на GPU
make up LLM=local

# Локальные эмбеддинги через TEI
make up EMBEDDING=local

# Полностью локальный AI-контур
make up LLM=local EMBEDDING=local

# MinIO вместо файлового storage
make up OBJECT_STORAGE=local

# Внешние Postgres/Qdrant/Docling
make up POSTGRES=cloud QDRANT=cloud DOCLING=cloud
```

## Архитектура

```text
Frontend (Next.js)
        |
        | REST / JSON / multipart upload
        v
FastAPI API  <-----------------------+
        |                            |
        | creates jobs               | reads job status/results
        v                            |
PostgreSQL <---- Worker -------------+
   |             |
   | metadata    | parse -> chunk -> embed -> upsert
   |             v
   |          Docling
   |             |
   |             v
   |          Embedding API / TEI
   |             |
   v             v
File storage   Qdrant
                 |
                 v
              LLM API
```

Роли компонентов:

| Компонент | Назначение |
|-----------|------------|
| `frontend/` | Пользовательский интерфейс на Next.js: проекты, документы, RAG-запросы, анализ противоречий. |
| `api/` | FastAPI-приложение: HTTP API, бизнес-логика, клиенты внешних сервисов. |
| `api/app/worker` | Фоновый воркер: берёт задания индексации и анализа из PostgreSQL. |
| PostgreSQL | Источник истины: проекты, документы, чанки, задания, результаты анализа. |
| Qdrant | Векторное хранилище для dense и sparse-поиска. |
| Docling | Извлечение текста из документов. При `USE_DOCLING=false` используется Python-парсер. |
| LLM API | Генерация ответов RAG и проверка потенциальных противоречий. |
| Embedding API / TEI | Получение dense-векторов для чанков и запросов. |

Чанки строятся по активной конфигурации индекса проекта (`chunk_size`,
`chunk_overlap`, `chunk_unit`). Реализация старается сохранять границы
предложений как в конце чанка, так и в начале следующего чанка; если подходящая
граница слишком далеко от целевого размера или overlap, используется fallback
по размеру. В Qdrant payload вместе с текстом сохраняются порядок чанка и
символьные границы.

RAG и анализ противоречий используют Qdrant hybrid retrieval через
`query_points` с `prefetch` и weighted `RrfQuery`. Для RAG настройки берутся из
`rag_dense_weight` / `rag_sparse_weight`, для противоречий — из
`contradiction_dense_weight` / `contradiction_sparse_weight`; при отсутствии
проектных значений используются env defaults. Если оба значения больше нуля,
участвуют dense и sparse ветки, а веса передаются в Qdrant как RRF weights;
нулевой вес отключает соответствующую ветку.
Примеры прямых Qdrant-запросов для dense, sparse и hybrid fusion находятся в
`api/README.md` и `api/scripts/curl_examples.sh`.

Для отладки retrieval без генерации ответа есть endpoint
`POST /api/v1/projects/{project_id}/retrieval/query`: он принимает raw text,
опциональные `dense_weight` / `sparse_weight`, фильтр по документам и возвращает
структурированный список найденных Qdrant points.
| Graylog | Просмотр структурированных логов, полезен для демонстрации и отладки. |

Подробная последовательность обработки показана в [UML Sequence.puml](</Users/damir/Documents/Diploma_Kubsu/UML Sequence.puml>).

## Жизненный цикл документа

1. Пользователь загружает файл в проект.
2. API сохраняет оригинал в storage и создаёт запись `documents.documents`.
3. API создаёт задачу в `documents.document_processing_jobs`.
4. Worker забирает задачу и переводит документ в `processing`.
5. Текст извлекается через Docling или локальный Python-парсер.
6. Текст делится на чанки с перекрытием.
7. Для чанков строятся dense-векторы и sparse-представление.
8. Чанки сохраняются в PostgreSQL, векторы — в Qdrant.
9. Документ получает статус `indexed` или `failed`.

Пока документ не `indexed`, он не участвует в RAG и анализе противоречий.

## RAG-запрос

RAG-запрос работает синхронно:

1. API получает вопрос пользователя.
2. Вопрос векторизуется тем же embedding-сервисом, что и документы.
3. Qdrant возвращает релевантные чанки по dense/sparse-сигналам.
4. Сервис собирает контекст из лучших фрагментов.
5. LLM формирует ответ и ссылки на найденные источники.

Если `target_document_ids` не переданы, поиск идёт по всем проиндексированным
документам проекта.

## Анализ противоречий

Анализ запускается асинхронно:

1. Пользователь выбирает базовый документ.
2. Система ищет семантически близкие фрагменты в целевых документах.
3. Кандидаты отправляются в LLM как пары утверждений.
4. LLM возвращает структурированный результат: есть ли конфликт, в чём он состоит,
   какие фрагменты подтверждают вывод.
5. Результат сохраняется в `analysis.analysis_jobs`.

Тестовый набор договоров лежит в [test_documents/contracts](</Users/damir/Documents/Diploma_Kubsu/test_documents/contracts/README.md>).

## Конфигурация

Все основные параметры задаются через `.env`. Шаблон: [.env.example](/Users/damir/Documents/Diploma_Kubsu/.env.example).

| Секция | Основные переменные |
|--------|---------------------|
| API | `APP_PORT`, `LOG_LEVEL`, `CORS_ALLOW_ORIGINS`, `UPLOAD_MAX_SIZE_MB` |
| PostgreSQL | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_DSN` |
| Qdrant | `QDRANT_URL`, `QDRANT_COLLECTION_NAME`, `QDRANT_ON_DISK_PAYLOAD` |
| LLM | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_SECONDS` |
| Embeddings | `EMBEDDING_BASE_URL`, `EMBEDDING_API_TYPE`, `EMBEDDING_BATCH_SIZE` |
| Индексация | `PROJECT_INDEX_DEFAULTS_CHUNK_SIZE`, `PROJECT_INDEX_DEFAULTS_CHUNK_OVERLAP`, `SPARSE_VECTOR_ENABLED` |
| Docling | `DOCLING_BASE_URL`, `DOCLING_TIMEOUT_SECONDS`, `USE_DOCLING` |
| Graylog | `GRAYLOG_ENABLED`, `GRAYLOG_HOST`, `GRAYLOG_PORT` |

Важно: модель эмбеддингов и размерность должны совпадать. Если embedding-сервис
возвращает 1024-мерные векторы, то `PROJECT_INDEX_DEFAULTS_EMBEDDING_DIMENSION`
тоже должен быть `1024`.

## API

Базовый адрес: `http://localhost:8080/api/v1`.

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/healthz` | Простая проверка API. |
| `GET` | `/healthz/ready` | Readiness endpoint. |
| `GET` | `/healthz/live` | Проверка PostgreSQL, Qdrant, embedding-сервиса и LLM. |
| `GET` | `/projects` | Список проектов. |
| `POST` | `/projects` | Создать проект. |
| `GET` | `/projects/{project_id}` | Получить проект. |
| `DELETE` | `/projects/{project_id}` | Удалить проект. |
| `GET` | `/projects/{project_id}/documents` | Список документов проекта. |
| `POST` | `/projects/{project_id}/documents` | Загрузить документ. |
| `GET` | `/projects/{project_id}/documents/{document_id}` | Метаданные документа. |
| `DELETE` | `/projects/{project_id}/documents/{document_id}` | Удалить документ. |
| `GET` | `/projects/{project_id}/documents/{document_id}/text` | Извлечённый текст. |
| `GET` | `/projects/{project_id}/documents/{document_id}/content` | Скачать оригинальный файл. |
| `POST` | `/projects/{project_id}/rag/query` | Задать вопрос по проекту. |
| `POST` | `/projects/{project_id}/analysis/contradictions` | Запустить анализ противоречий. |
| `GET` | `/projects/{project_id}/analysis/contradictions` | Список задач анализа. |
| `GET` | `/projects/{project_id}/analysis/contradictions/{job_id}` | Статус и результат задачи. |

OpenAPI-спецификация лежит в [api-docs-swagger/specs/rag-system-api.yaml](/Users/damir/Documents/Diploma_Kubsu/api-docs-swagger/specs/rag-system-api.yaml).

## Структура репозитория

```text
.
├── Makefile                         # команды запуска backend-стека
├── docker-compose.yml               # корневой compose с include-файлами
├── README.md                        # этот обзор
├── UML Sequence.puml                # диаграммы основных сценариев
├── api/                             # FastAPI backend и worker
├── frontend/                        # Next.js frontend
├── api-docs-swagger/                # OpenAPI contract
├── knowledge_db/                    # PostgreSQL compose и DBML-схема
├── qdrant/                          # Qdrant compose
├── document_parsing_service/        # Docling compose и описание
├── embedding/                       # локальный TEI-сервис
├── llm/                             # локальный vLLM-сервис
├── minio/                           # S3-compatible storage
├── graylog/                         # Graylog + MongoDB + Elasticsearch
├── scripts/                         # вспомогательные скрипты
└── test_documents/                  # демонстрационные и тестовые документы
```

## Тестовые данные

- `test_documents/contracts/` — пары корректных и намеренно проблемных договоров.
- `test_documents/legal/` — фрагменты нормативных текстов РФ.
- `test_documents/prestuplenie_i_nakazanie.txt` и `vojna_i_mir.txt` — большие тексты для проверки нагрузки индексации и RAG.
- `api/scripts/test_docs/` — компактные документы для интеграционных тестов.

## Проверка после запуска

```bash
# API отвечает
curl -s http://localhost:8080/healthz

# Создать проект
curl -s -X POST http://localhost:8080/api/v1/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"demo","description":"проверочный проект"}'

# Загрузить документ
curl -s -X POST http://localhost:8080/api/v1/projects/1/documents \
  -F 'display_name=sample_plain.txt' \
  -F 'file=@api/scripts/test_docs/sample_plain.txt;type=text/plain'
```

После загрузки проверьте статус документа:

```bash
curl -s http://localhost:8080/api/v1/projects/1/documents/1
```

Индексация завершена, когда статус стал `indexed`.

## Технологический стек

| Слой | Технологии |
|------|------------|
| Backend | Python 3.12, FastAPI, Uvicorn, SQLAlchemy async |
| Миграции | Alembic |
| Worker | asyncio-процесс внутри API-образа |
| База данных | PostgreSQL 16 |
| Векторное хранилище | Qdrant |
| Документ-парсинг | Docling Serve, PyPDF2/python-docx/BeautifulSoup fallback |
| Embeddings | OpenAI-compatible API или Hugging Face TEI |
| LLM | OpenAI-compatible API или локальный vLLM |
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| Логи | structlog, опционально Graylog |

## Частые проблемы

| Симптом | Что проверить |
|---------|---------------|
| Документ долго остаётся `uploaded` | Работает ли контейнер `rag-system-worker`; нет ли старых задач перед ним в очереди. |
| Документ стал `failed` | `docker logs rag-system-worker`, настройки Docling, лимит размера файла, доступность embedding API. |
| RAG отвечает без источников | Есть ли в проекте документы со статусом `indexed`; совпадает ли размерность embedding-модели. |
| `make up` пытается собрать образ | Это нормально при первом запуске. Для обычной пересборки используйте `make up-build`. |
| Graylog стартует долго | Для разработки запускайте `make fast-up`. |

## Связанные документы

- [api/README.md](/Users/damir/Documents/Diploma_Kubsu/api/README.md) — устройство backend и worker.
- [frontend/README.md](/Users/damir/Documents/Diploma_Kubsu/frontend/README.md) — запуск и структура интерфейса.
- [document_parsing_service/README.md](/Users/damir/Documents/Diploma_Kubsu/document_parsing_service/README.md) — Docling.
- [knowledge_db/rag-system_schema.dbml](/Users/damir/Documents/Diploma_Kubsu/knowledge_db/rag-system_schema.dbml) — схема данных.
- [test_documents/contracts/README.md](/Users/damir/Documents/Diploma_Kubsu/test_documents/contracts/README.md) — сценарии проверки противоречий.
