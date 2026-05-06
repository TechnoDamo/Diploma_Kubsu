# Mimir Frontend

Одностраничный Next.js + Tailwind frontend для RAG-системы Mimir.

## Что реализовано

- One-screen UX: upload -> processing -> ask -> answer
- Индикатор статуса сервера
- Тема `System / Light / Dark`
- Загрузка файлов: PDF, DOC, DOCX, TXT, MD
- Отслеживание статуса обработки документа
- Блок вопросов с demo-кнопками
- Ответ с цитатами и confidence
- Разные error states (server unavailable, unsupported file, upload/processing/server errors)
- Список документов, просмотр extracted text, удаление документа
- Запуск contradiction analysis job и polling результата

## Стек

- Next.js (App Router)
- TypeScript
- Tailwind CSS

## Запуск

```bash
npm install
npm run dev
```

Открыть: [http://localhost:3000](http://localhost:3000)

## Backend

По умолчанию фронт обращается к:

`http://localhost:8080/api/v1`

Переопределить можно через `.env`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1
```

## API

В `lib/api.ts` описаны вызовы по API:

- Projects: list/create/get/delete
- Documents: list/upload/get/delete
- Content: get text / content
- RAG: query
- Analysis: start contradictions / poll result
