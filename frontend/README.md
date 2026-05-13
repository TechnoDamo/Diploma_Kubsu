# Mimir Frontend

Frontend — одностраничный интерфейс на Next.js для работы с проектами, документами,
RAG-запросами и анализом противоречий. Он не поднимается корневым Docker Compose:
для разработки и демонстрации его проще запускать локально.

## Запуск

```bash
npm install
npm run dev
```

Открыть: `http://localhost:3000`.

Backend по умолчанию ожидается на `http://localhost:8080/api/v1`.
Если API запущен на другом адресе, создайте или измените `frontend/.env`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1
```

## Основные экраны и действия

- Список проектов и создание проекта.
- Загрузка документов в проект.
- Отображение статусов `uploaded`, `processing`, `indexed`, `failed`.
- Просмотр извлечённого текста документа.
- Удаление документов и проектов.
- RAG-вопросы по всем документам проекта или по выбранным документам.
- Запуск анализа противоречий и polling результата.
- Переключение темы интерфейса.

## Структура

```text
frontend/
├── app/
│   ├── layout.tsx           # корневой layout
│   ├── page.tsx             # список проектов / стартовый экран
│   ├── health/route.ts      # health endpoint frontend-приложения
│   └── projects/[id]/page.tsx
├── lib/
│   ├── api.ts               # HTTP-клиент backend API
│   ├── types.ts             # TypeScript-типы API
│   └── i18n.ts              # текстовые константы интерфейса
├── public/                  # SVG-логотипы и статические файлы
├── Dockerfile               # production build, если frontend нужен в контейнере
├── package.json
└── tailwind.config.ts
```

## Команды

| Команда | Назначение |
|---------|------------|
| `npm run dev` | Локальный dev-server Next.js. |
| `npm run build` | Production-сборка. |
| `npm run start` | Запуск production build. |
| `npm run lint` | Next/ESLint проверка. |

## Что проверить при демонстрации

1. Backend отвечает на `http://localhost:8080/healthz`.
2. В `frontend/.env` указан правильный `NEXT_PUBLIC_API_BASE_URL`.
3. В проекте есть хотя бы один документ со статусом `indexed`.
4. Для RAG-вопроса выбран проект, где уже завершилась индексация.
5. Если анализ противоречий не стартует, базовый документ ещё не `indexed`
   или в проекте нет подходящих целевых документов.
