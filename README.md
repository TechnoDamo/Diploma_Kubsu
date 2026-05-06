# Mimir — Интеллектуальная RAG-система с кросс-документным анализом

> Платформа retrieval-augmented generation для построения баз знаний документов
> с фокусом на **автоматическое обнаружение противоречий** и **семантическое сравнение**.

---

## Обзор проекта

Mimir — это RAG-система для семантического хранения и анализа документов.
Позволяет загружать, просматривать и удалять файлы (PDF, DOCX, TXT, HTML, MD),
задавать вопросы на естественном языке по содержимому всей базы знаний,
а также находить **противоречия между документами** с помощью
гибридного семантического поиска и LLM-анализа.

## Ключевые возможности

- Загрузка, удаление и просмотр документов в централизованной базе знаний
- Вопросы на естественном языке с получением обоснованных ответов со ссылками на источники
- Автоматическое обнаружение противоречий и несоответствий между документами
- Гибридный поиск (dense + sparse) с раздельными настройками для RAG и анализа противоречий
- Гибкое развёртывание: локальный AI на GPU или облачные API

## Сценарии использования

- **Проверка корпоративной базы знаний** — автоматическое обнаружение противоречий между политиками, регламентами и инструкциями
- **Анализ научной литературы** — сравнение статей и отчётов для поиска конфликтующих утверждений
- **Юридический анализ** — проверка договоров и нормативных документов на несоответствия
- **Мониторинг регуляторных изменений** — отслеживание противоречий между новыми и существующими документами

---

## Быстрый старт

```bash
# Дефолтный запуск (LLM и embedding — cloud, остальное локально, Graylog — on)
make up

# Полностью локальный AI с GPU
make up LLM=local EMBEDDING=local

# Всё в облаке
make up DOCLING=cloud POSTGRES=cloud QDRANT=cloud OBJECT_STORAGE=cloud

# Без Graylog
make up GRAYLOG=false

# Остановка
make down
```

Приложение доступно на `http://localhost:3001`, API на `http://localhost:8080`, Graylog на `http://localhost:19000` (логин: admin/admin).

---

## Флаги развёртывания

| Флаг | По умолчанию | Значения | Назначение |
|------|-------------|----------|-----------|
| `LLM` | `cloud` | `local`, `cloud` | vLLM на GPU или DeepSeek API |
| `EMBEDDING` | `cloud` | `local`, `cloud` | TEI на GPU или RouterAI API |
| `DOCLING` | `local` | `local`, `cloud` | Docling Serve локально или удалённо |
| `POSTGRES` | `local` | `local`, `cloud` | PostgreSQL локально или удалённо |
| `QDRANT` | `local` | `local`, `cloud` | Qdrant локально или удалённо |
| `OBJECT_STORAGE` | `filesystem` | `filesystem`, `local`, `cloud` | Локальная папка, MinIO или S3 |
| `GRAYLOG` | `local` | `local`, `false` | Централизованное логирование |

---

## Архитектура

```
[React/TypeScript фронтенд]
        │ HTTP REST
        ▼
[FastAPI бэкенд]  ←→  [Воркер (фоновые задачи)]
   │       │               │         │
   ▼       ▼               ▼         ▼
[PostgreSQL] [Qdrant]   [TEI]   [vLLM/DeepSeek]
   │          │           │          │
   │          ▼           ▼          ▼
   │    [dense+sparse] [embeddings] [LLM]
   │
   ▼
[Docling] → парсинг PDF/DOCX/HTML → текст
```

- **PostgreSQL** — источник истины: проекты, документы, чанки, задания
- **Qdrant** — векторная БД: dense + sparse векторы для гибридного поиска
- **TEI** — эмбеддинги (Hugging Face Text Embeddings Inference)
- **vLLM / DeepSeek** — генерация ответов и анализ противоречий
- **Docling** — парсинг документов в текст
- **MinIO** — опциональное S3-совместимое объектное хранилище
- **Graylog** — централизованное логирование (включено по умолчанию)

---

## Гибридный поиск

Два независимых пайплайна с раздельными весами:

| Параметр | RAG (поиск информации) | Противоречия |
|----------|----------------------|-------------|
| `DENSE_WEIGHT` | 0.7 | 0.5 |
| `SPARSE_WEIGHT` | 0.3 | 0.5 |
| `TOP_K` | 5 | 5 |

Dense-векторы — через TEI/embedding API (sentence embeddings).
Sparse-векторы — через BM25/Qdrant tokenizer (ключевые слова).
Все веса настраиваются через `.env`.

---

## Структура проекта

```
mimir/
├── docker-compose.yml       # корневой compose (include: все сервисы)
├── Makefile                 # up/down + флаги деплоя
├── .env.example             # 120+ строк с комментариями на русском
├── README.md
│
├── api/                     # Python/FastAPI бэкенд
│   ├── app/                 # исходный код (routers, services, models, infra, worker)
│   ├── prompts/             # 4 промпта на русском
│   ├── pyproject.toml       # uv-зависимости
│   ├── Dockerfile
│   ├── docker-compose.yaml
│   └── Makefile
│
├── frontend/                # React/TypeScript SPA
│
├── embedding/               # TEI сервис (GPU/CPU)
├── llm/                     # vLLM сервис (GPU)
├── document_parsing_service/ # Docling парсинг
├── knowledge_db/            # PostgreSQL + миграции
├── qdrant/                  # Qdrant векторная БД
├── minio/                   # S3-совместимое хранилище
├── graylog/                 # Логирование
├── models/                  # Кеш HF-моделей
├── scripts/                 # Утилиты (download_hf_model, setup-ai)
└── test_docs/               # Тестовые документы
```

---

## Конфигурация

Все параметры задаются в `.env`. Пример в `.env.example`. Ключевые секции:

- **LLM** — `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (по умолчанию DeepSeek)
- **Embedding** — `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` (по умолчанию RouterAI)
- **Qdrant** — `QDRANT_URL`, `QDRANT_COLLECTION_NAME`
- **Гибридный поиск** — `RAG_DENSE_WEIGHT`, `RAG_SPARSE_WEIGHT`, `CONTRADICTION_DENSE_WEIGHT`, `CONTRADICTION_SPARSE_WEIGHT`
- **Sparse** — `SPARSE_VECTOR_ENABLED`, `SPARSE_MODEL`
- **Парсинг документов** — `USE_DOCLING=true` (Docling) или `false` (PyPDF2)
- **Загрузка файлов** — `UPLOAD_MAX_SIZE_MB` (по умолчанию 25 МБ)
- **Порты** — `APP_PORT`, `FRONTEND_HOST_PORT`, `QDRANT_PORT`, `DOCLING_PORT`, `GRAYLOG_UI_HOST_PORT` и др.

---

## API эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/healthz` | Проверка здоровья |
| `GET` | `/api/v1/projects` | Список проектов |
| `POST` | `/api/v1/projects` | Создать проект |
| `GET` | `/api/v1/projects/{id}` | Детали проекта |
| `DELETE` | `/api/v1/projects/{id}` | Удалить проект |
| `GET` | `/api/v1/projects/{pid}/documents` | Список документов |
| `POST` | `/api/v1/projects/{pid}/documents` | Загрузить документ |
| `GET` | `/api/v1/projects/{pid}/documents/{did}` | Детали документа |
| `DELETE` | `/api/v1/projects/{pid}/documents/{did}` | Удалить документ |
| `GET` | `/api/v1/projects/{pid}/documents/{did}/text` | Текст документа |
| `GET` | `/api/v1/projects/{pid}/documents/{did}/content` | Скачать оригинал |
| `POST` | `/api/v1/projects/{pid}/rag/query` | RAG-запрос |
| `POST` | `/api/v1/projects/{pid}/analysis/contradictions` | Запустить анализ противоречий |
| `GET` | `/api/v1/projects/{pid}/analysis/contradictions/{jid}` | Статус анализа |

---

## Схема базы данных

![DB schema](knowledge_db/ERD.png)

- **documents.projects** — проекты (базы знаний) с состоянием
- **documents.project_index_configs** — конфигурации индексации (модель, размер чанка, веса)
- **documents.documents** — загруженные файлы с жизненным циклом
- **documents.chunks** — текстовые чанки с привязкой к точкам Qdrant (`qdrant_point_id`)
- **documents.document_processing_jobs** — очередь заданий индексации
- **documents.document_history** — аудит операций над документами
- **analysis.analysis_jobs** — задания анализа противоречий (результаты в JSONB)
- **analysis.analysis_job_targets** — целевые документы для анализа

---

## Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Бэкенд | Python 3.12, FastAPI, Uvicorn |
| БД | PostgreSQL 16 |
| Векторная БД | Qdrant (гибридный dense+sparse поиск) |
| Парсинг документов | Docling Serve |
| Эмбеддинги | TEI / OpenAI-compatible API |
| LLM | DeepSeek / OpenAI-compatible API |
| Фронтенд | React 18, TypeScript, Vite 6, TanStack Query |
| Инфраструктура | Docker Compose |
| Миграции | Goose |
| Пакетный менеджер | uv (Python), npm (Frontend) |
| Логирование | structlog + Graylog |
