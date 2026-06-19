# Сервис разбора документов

Этот компонент отвечает за извлечение текста из файлов. В основном сценарии RAG System
использует Docling Serve: отдельный HTTP-сервис поверх библиотеки Docling.

Поддерживаемые системой форматы загрузки:

- `PDF`
- `DOCX`
- `TXT`
- `MD`
- `HTML`

Если в `.env` задано `USE_DOCLING=false`, backend использует встроенный Python fallback:
`PyPDF2` для PDF, `python-docx` для DOCX, `BeautifulSoup` для HTML и обычное чтение
для текстовых файлов. Такой режим быстрее поднимается локально, но Docling обычно
лучше работает со сложными PDF.

## Запуск в составе проекта

Из корня репозитория:

```bash
make up
```

Профиль `DOCLING=local` включён по умолчанию, поэтому контейнер `rag-system-docling`
будет поднят автоматически. API обращается к нему по адресу:

```text
http://docling:5001
```

Снаружи контейнер доступен на:

```text
http://localhost:5001
```

## Запуск отдельно

```bash
docker run -d \
  --name docling-serve \
  --restart unless-stopped \
  -p 5001:5001 \
  -e DOCLING_SERVE_ENABLE_UI=1 \
  quay.io/docling-project/docling-serve:latest
```

GPU для текущего сценария не обязателен. Если нужен GPU-вариант, добавьте параметры
Docker под конкретную машину и установленный runtime.

## Настройки

| Переменная | Назначение |
|------------|------------|
| `DOCLING_BASE_URL` | Адрес Docling из контейнеров backend. Обычно `http://docling:5001`. |
| `DOCLING_PORT` | Порт, опубликованный на host. По умолчанию `5001`. |
| `DOCLING_TIMEOUT_SECONDS` | Таймаут разбора больших документов. |
| `USE_DOCLING` | `true` — использовать Docling; `false` — Python fallback. |

## Где смотреть ошибки

```bash
docker logs --tail 100 rag-system-docling
docker logs --tail 100 rag-system-worker
```

Если документ переходит в `failed`, причина обычно хранится в поле `failure_reason`
документа и в `last_error` задачи индексации.
