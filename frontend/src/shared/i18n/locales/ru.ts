import type { AnalysisJobStatus, DocumentStatus } from "../../types/api";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatCount(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${value} ${one}`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${value} ${few}`;
  }
  return `${value} ${many}`;
}

function formatDocumentStatus(status: DocumentStatus) {
  switch (status) {
    case "indexed":
      return "проиндексирован";
    case "failed":
      return "ошибка";
    case "processing":
      return "обрабатывается";
    case "uploaded":
      return "загружен";
    default:
      return status;
  }
}

function formatAnalysisStatus(status: AnalysisJobStatus) {
  switch (status) {
    case "queued":
      return "в очереди";
    case "processing":
      return "обрабатывается";
    case "completed":
      return "завершён";
    case "failed":
      return "ошибка";
    default:
      return status;
  }
}

export const ru = {
  appShell: {
    navProjects: "Проекты",
    title: "Консоль Mimir RAG",
    mockMode: "Включены моки",
    liveMode: "Живой бэкенд",
  },
  shared: {
    unknownApiError: "API вернул неожиданный формат ошибки",
    unexpectedHttpError: (status: number) => `Сервис вернул неожиданный ответ (HTTP ${status}).`,
    backToProjects: "Вернуться к проектам",
    backToProject: "Назад к проекту",
    refresh: "Обновить сейчас",
    refreshing: "Обновляем...",
    delete: "Удалить",
    openDocument: "Открыть документ",
    statusDocument: formatDocumentStatus,
    statusAnalysis: formatAnalysisStatus,
    counts: {
      documents: (value: number) => formatCount(value, "документ", "документа", "документов"),
      findings: (value: number) => formatCount(value, "находка", "находки", "находок"),
      candidates: (value: number) => formatCount(value, "кандидат", "кандидата", "кандидатов"),
      indexed: (value: number) =>
        formatCount(value, "проиндексирован", "проиндексировано", "проиндексировано"),
      processing: (value: number) =>
        `${formatCount(value, "ещё обрабатывается", "ещё обрабатываются", "ещё обрабатываются")}`,
    },
    updatedAt: (value: string) => `Обновлён: ${formatDateTime(value)}`,
  },
  router: {
    notFoundTitle: "Страница не найдена",
    notFoundSubtitle: "Запрошенный маршрут не существует.",
    notFoundBody: "Используйте навигацию, чтобы вернуться на существующую страницу.",
  },
  projectsList: {
    errors: {
      create: "Не удалось создать проект.",
      load: "Не удалось загрузить проекты.",
    },
    confirmDelete:
      "Удалить этот проект? Все документы и связанные задачи анализа тоже будут удалены.",
    title: "Центр управления",
    subtitle:
      "Создавайте рабочие пространства, загружайте материалы и запускайте поиск и анализ противоречий на живом бэкенде.",
    metrics: {
      loadedLabel: "Загружено проектов",
      loadedBody: "Рабочие пространства, доступные для загрузки документов и поиска.",
      backendModeLabel: "Режим бэкенда",
      backendModeValue: "Живой API",
      backendModeBody: "Моки не используются, пока вы явно не включите их через env.",
      workflowLabel: "Сценарий работы",
      workflowValue: "Загрузка → Индексация → Запрос",
      workflowBody: "Проект служит рабочим контуром для документов и задач анализа.",
    },
    create: {
      kicker: "Создание",
      title: "Новый проект",
      name: "Название",
      namePlaceholder: "Аудит корпоративного управления",
      description: "Описание",
      descriptionPlaceholder:
        "Для чего нужен этот проект, какую предметную область он покрывает и что ассистенту стоит учитывать при поиске.",
      creating: "Создаём проект...",
      submit: "Создать проект",
    },
    list: {
      kicker: "Активные пространства",
      title: "Проекты",
      visible: (count: number) => `Показано: ${count}`,
      loading: "Загружаем проекты...",
      emptyTitle: "Проектов пока нет",
      emptyBody:
        "Создайте первый проект, чтобы начать загружать документы и запускать RAG.",
      noDescription: "Описание не задано.",
      open: "Открыть проект",
    },
  },
  projectDetails: {
    invalid: {
      title: "Некорректный проект",
      subtitle: "Маршрут к проекту указан в неверном формате.",
      body: "Идентификатор проекта должен быть положительным целым числом.",
    },
    errors: {
      rag: "Не удалось выполнить запрос.",
      analysis: "Не удалось запустить анализ противоречий.",
      loadProject: "Не удалось загрузить проект.",
      upload: "Не удалось загрузить документ.",
      loadDocuments: "Не удалось загрузить документы.",
    },
    titleFallback: "Рабочее пространство проекта",
    subtitle:
      "Загружайте документы, отслеживайте индексацию, задавайте RAG-запросы и запускайте анализ противоречий по проиндексированным материалам.",
    hero: {
      idle: "Конвейер простаивает",
      documentCount: (count: number) => `${count} документов`,
      indexedCount: (count: number) => `${count} проиндексировано`,
      processingCount: (count: number) => `${count} ещё обрабатывается`,
    },
    overview: {
      loading: "Загружаем проект...",
      kicker: "Обзор проекта",
      title: "Сводка по проекту",
      noDescription: "Описание не задано.",
      indexed: "Проиндексировано",
      queued: "В очереди / обрабатывается",
      failed: "С ошибкой",
    },
    upload: {
      kicker: "Загрузка",
      title: "Загрузить документ",
      file: "Файл",
      displayName: "Отображаемое имя",
      displayNamePlaceholder: "Необязательное пользовательское имя",
      hint: (sizeMiB: string) =>
        `Сейчас поддерживаются: txt, md, html, pdf, docx. Максимальный размер файла: ${sizeMiB} MiB. Для HTML, PDF и DOCX требуется готовность Docling.`,
      loading: "Загружаем...",
      submit: "Загрузить в проект",
    },
    documents: {
      kicker: "Корпус",
      title: "Документы",
      refresh: "Обновить список",
      refreshing: "Обновляем...",
      loading: "Загружаем документы...",
      emptyTitle: "Документов пока нет",
      emptyBody: "Загрузите текст, markdown, HTML, PDF или DOCX, чтобы начать индексацию.",
      failedWarning:
        "Обработка завершилась ошибкой. Откройте страницу документа, чтобы посмотреть текущее состояние и повторить попытку после исправлений на бэкенде.",
      deleteConfirm: "Удалить этот документ?",
    },
    rag: {
      kicker: "Запрос",
      title: "RAG-запрос",
      candidateCount: (count: number) => `${count} кандидатов для поиска`,
      question: "Вопрос",
      questionPlaceholder: "Что стандарт закупок требует перед подключением нового поставщика?",
      targetLegend: "Целевые документы (необязательно, только проиндексированные)",
      noIndexed: "Пока нет доступных проиндексированных документов.",
      loading: "Выполняем поиск...",
      submit: "Спросить корпус",
      answer: "Ответ",
      warningPresent: "Есть предупреждение",
      citations: "Цитаты",
      citationCount: (count: number) => formatCount(count, "цитата", "цитаты", "цитат"),
      citationDocument: (id: number) => `Документ #${id}`,
      citationAnswerLabel: "Фрагмент ответа",
      citationSourceLabel: "Источник в исходном файле",
      citationPreviewFallback: "Нажмите, чтобы раскрыть фрагмент.",
      noCitations: "Цитаты не были возвращены.",
    },
    analysis: {
      kicker: "Сравнение",
      title: "Анализ противоречий",
      baseDocument: "Базовый документ",
      basePlaceholder: "Выберите проиндексированный базовый документ",
      targetLegend: "Целевые документы (необязательно, только проиндексированные)",
      loading: "Ставим анализ в очередь...",
      submit: "Запустить асинхронный анализ",
      help:
        "Бэкенд сравнивает сохранённые эмбеддинги чанков базового документа с ближайшими чанками целевых документов, а затем запускает LLM для оценки противоречий и итоговой сводки по документу.",
    },
  },
  documentDetails: {
    invalid: {
      title: "Некорректный маршрут документа",
      subtitle: "Маршрут к документу указан в неверном формате.",
      body: "Идентификаторы проекта и документа должны быть положительными целыми числами.",
    },
    errors: {
      metadata: "Не удалось загрузить метаданные документа.",
      text: "Не удалось загрузить извлечённый текст.",
      content: "Не удалось загрузить содержимое документа.",
    },
    titleFallback: "Документ",
    subtitle:
      "Проверяйте состояние документа, восстановленный текст и исходный файл по мере работы конвейера индексации.",
    metadata: {
      kicker: "Метаданные",
      title: "Состояние документа",
      loading: "Загружаем документ...",
      id: (id: number) => `ID: ${id}`,
      updated: (value: string) => `Последнее обновление: ${formatDateTime(value)}`,
      failedWarning:
        "Обработка завершилась ошибкой. Обычно это значит, что парсер или последующий конвейер индексации отклонил файл.",
      refresh: "Обновить статус",
      refreshing: "Обновляем...",
    },
    text: {
      kicker: "Текст",
      title: "Извлечённый текст",
      loading: "Загружаем извлечённый текст...",
      pending:
        "Извлечённый текст пока не готов. Оставьте страницу открытой, пока идёт обработка.",
      check: "Проверить доступность текста",
      checking: "Проверяем...",
    },
    content: {
      kicker: "Исходный файл",
      title: "Оригинальное содержимое",
      body: "Этот раздел использует `/content` и загружает исходный файл через браузерный object URL.",
      load: "Загрузить содержимое",
      loading: "Подготавливаем...",
      download: "Скачать файл",
    },
  },
  analysisDetails: {
    invalid: {
      title: "Некорректный маршрут анализа",
      subtitle: "Маршрут к задаче анализа указан в неверном формате.",
      body: "Идентификаторы проекта и задачи должны быть положительными целыми числами.",
    },
    title: "Анализ противоречий",
    subtitle:
      "Отслеживайте асинхронную задачу сравнения, просматривайте сводки по целевым документам и изучайте доказательства противоречий.",
    hero: {
      job: (id: number) => `Задача #${id}`,
    },
    job: {
      kicker: "Асинхронная задача",
      title: "Статус выполнения",
      loading: "Загружаем задачу...",
      loadError: "Не удалось загрузить задачу анализа.",
      idLabel: "Задача",
      statusLabel: "Статус",
      findingsLabel: "Цели с находками",
      polling: "Опрос каждые 2 секунды...",
      failedFallback: "Анализ завершился ошибкой без подробностей.",
      resultsKicker: "Результаты",
      resultsTitle: "Найденные противоречия",
      empty: "Противоречий не найдено.",
      targetDocument: (id: number) => `Целевой документ #${id}`,
      summaryLabel: "Сводка по целевому документу",
      noTargetContradictions: "В этом целевом документе противоречий нет.",
      contradictionPreviewFallback: "Нажмите, чтобы раскрыть детали противоречия.",
      confidence: (value: number) => `Уверенность ${value.toFixed(2)}`,
      chunkPair: (base: number, target: number) => `база ${base} / цель ${target}`,
      base: "База:",
      target: "Цель:",
      explanation: "Почему это противоречие:",
    },
  },
};

export type Locale = typeof ru;
