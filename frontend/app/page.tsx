'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CheckSquare,
  Eye,
  FileText,
  Loader2,
  Moon,
  PenSquare,
  PanelLeft,
  Paperclip,
  Send,
  ServerOff,
  Square,
  Sun,
  Trash2,
  Wifi,
  X
} from 'lucide-react';
import { ragApi } from '@/lib/api';
import {
  ApiError,
  type Contradiction,
  type ContradictionResult,
  type Document,
  type Project,
  type ServerStatus,
  type ThemeMode
} from '@/lib/types';

const SUPPORTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'md'];
const MAX_FILES_PER_PROJECT = 5;
const MAX_FILE_SIZE_MB = Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_SIZE_MB) || 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000;
const CHAT_SCROLL_DURATION_MS = 2000;
const CHAT_SCROLL_SECOND_PASS_DELAY_MS = 320;
const FLYING_MESSAGE_MOVE_MS = 120;
const FLYING_MESSAGE_FADE_MS = 480;
const MAX_PARALLEL_UPLOADS = 5;

const STORAGE_KEYS = {
  uploadBlockedUntil: 'rag-demo-upload-blocked-until',
  queryBlockedUntil: 'rag-demo-query-blocked-until',
  uploadedDocumentMeta: 'rag-demo-uploaded-document-meta'
} as const;

type Citation = {
  document_id: number;
  document_name: string;
  snippet: string;
};

type ChatMessage =
  | {
      id: string;
      role: 'user';
      text: string;
      scopeLabel?: string;
      isPendingAppearance?: boolean;
    }
  | {
      id: string;
      role: 'assistant';
      text: string;
      citations: Citation[];
      confidence: number;
      warning?: string;
      isStreaming?: boolean;
      streamRevealChars?: number;
    };

type UiError = {
  message: string;
};

type UploadState = 'idle' | 'uploading' | 'processing' | 'indexed' | 'error';

type RightPanelView = 'files' | 'document' | 'contradiction';

type DocumentPreview = {
  documentId: number;
  documentName: string;
  text: string;
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  highlightSnippet?: string;
};

type ContradictionJob = {
  id: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  baseDocumentId: number;
  targetDocumentIds: number[];
  createdAt: string;
  updatedAt: string;
  result?: ContradictionResult[];
  error?: string;
};

type FlyingMessage = {
  id: string;
  targetMessageId: string;
  text: string;
  start: { left: number; top: number; width: number; height: number };
  end: { left: number; top: number; width: number; height: number };
  phase: 'start' | 'end' | 'fade';
};

type UploadBatchProgress = {
  total: number;
  completed: number;
  failed: number;
  active: boolean;
  stepStartedAt: number;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const workersCount = Math.max(1, Math.min(limit, tasks.length));
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  };

  await Promise.all(Array.from({ length: workersCount }, () => worker()));
  return results;
}

function streamReveal(totalChars: number, onProgress: (visibleChars: number) => void) {
  return new Promise<void>((resolve) => {
    if (totalChars <= 0) {
      onProgress(0);
      resolve();
      return;
    }

    const durationMs = Math.min(5200, Math.max(900, totalChars * 18));
    const startedAt = performance.now();
    let revealedChars = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 1.8);
      const nextChars = Math.min(totalChars, Math.max(1, Math.round(totalChars * eased)));

      if (nextChars !== revealedChars) {
        revealedChars = nextChars;
        onProgress(revealedChars);
      }

      if (progress < 1) {
        window.requestAnimationFrame(tick);
        return;
      }

      onProgress(totalChars);
      resolve();
    };

    window.requestAnimationFrame(tick);
  });
}

function isAllowedFile(file: File) {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return SUPPORTED_EXTENSIONS.includes(ext);
}

function buildConfidence(citationsCount: number) {
  const raw = 0.58 + Math.min(citationsCount, 3) * 0.1;
  return Number(Math.min(0.91, raw).toFixed(2));
}

function normalizeHighlightSnippet(snippet?: string) {
  if (!snippet) return '';
  return snippet
    .replaceAll('…', '')
    .replaceAll('...', '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSnippetRange(text: string, snippet?: string) {
  const cleanedSnippet = normalizeHighlightSnippet(snippet);
  if (!cleanedSnippet) return null;

  const lowerText = text.toLocaleLowerCase();
  const lowerSnippet = cleanedSnippet.toLocaleLowerCase();

  const directIndex = lowerText.indexOf(lowerSnippet);
  if (directIndex >= 0) {
    return { start: directIndex, end: directIndex + cleanedSnippet.length };
  }

  const words = cleanedSnippet.split(' ').filter((word) => word.length > 2).slice(0, 6);
  if (words.length < 2) return null;

  const pattern = words.map((word) => escapeRegExp(word)).join('[\\s\\S]{0,50}?');
  const regex = new RegExp(pattern, 'i');
  const match = regex.exec(text);
  if (!match || match.index == null) return null;

  return { start: match.index, end: match.index + match[0].length };
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  let lastIndex = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0];
    const offset = match.index ?? 0;

    if (offset > lastIndex) {
      nodes.push(text.slice(lastIndex, offset));
    }

    const linkLabel = match[2];
    const linkHref = match[3];
    const inlineCode = match[4];
    const boldA = match[5];
    const boldB = match[6];
    const italicA = match[7];
    const italicB = match[8];

    if (linkLabel && linkHref) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${index}`}
          href={linkHref}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-[var(--accent)]/45 underline-offset-2 hover:text-[var(--accent)]"
        >
          {linkLabel}
        </a>
      );
    } else if (inlineCode) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${index}`}
          className="rounded bg-[var(--line)]/45 px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {inlineCode}
        </code>
      );
    } else if (boldA || boldB) {
      nodes.push(<strong key={`${keyPrefix}-bold-${index}`}>{boldA ?? boldB}</strong>);
    } else if (italicA || italicB) {
      nodes.push(<em key={`${keyPrefix}-italic-${index}`}>{italicA ?? italicB}</em>);
    } else {
      nodes.push(fullMatch);
    }

    lastIndex = offset + fullMatch.length;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderMarkdownText(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isUnordered = (line: string) => /^\s*[-*+]\s+/.test(line);
  const isOrdered = (line: string) => /^\s*\d+\.\s+/.test(line);
  const isHeading = (line: string) => /^#{1,6}\s+/.test(line);
  const isQuote = (line: string) => /^\s*>\s+/.test(line);
  const isFence = (line: string) => line.trim().startsWith('```');
  const isBreak = (line: string) => line.trim() === '';
  const isBlockStart = (line: string) =>
    isBreak(line) || isFence(line) || isHeading(line) || isQuote(line) || isUnordered(line) || isOrdered(line);

  while (i < lines.length) {
    const line = lines[i];

    if (isBreak(line)) {
      i += 1;
      continue;
    }

    if (isFence(line)) {
      const language = line.trim().slice(3).trim();
      i += 1;
      const codeLines: string[] = [];

      while (i < lines.length && !isFence(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && isFence(lines[i])) {
        i += 1;
      }

      blocks.push(
        <pre
          key={`md-pre-${key}`}
          className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--bg)]/75 p-3 font-mono text-xs sm:text-sm"
        >
          {language ? <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">{language}</div> : null}
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      key += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6);
      const content = headingMatch[2];
      const titleClass =
        level <= 2
          ? 'text-base font-semibold sm:text-lg'
          : level <= 4
            ? 'text-sm font-semibold sm:text-base'
            : 'text-sm font-medium';
      blocks.push(
        <p key={`md-h-${key}`} className={titleClass}>
          {renderInlineMarkdown(content, `md-h-${key}`)}
        </p>
      );
      key += 1;
      i += 1;
      continue;
    }

    if (isQuote(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s+/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={`md-q-${key}`} className="border-l-2 border-[var(--accent)]/45 pl-3 text-[var(--muted)]">
          {renderInlineMarkdown(quoteLines.join('\n'), `md-q-${key}`)}
        </blockquote>
      );
      key += 1;
      continue;
    }

    if (isUnordered(line)) {
      const items: string[] = [];
      while (i < lines.length && isUnordered(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`md-ul-${key}`} className="list-disc space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={`md-ul-${key}-li-${idx}`}>{renderInlineMarkdown(item, `md-ul-${key}-li-${idx}`)}</li>
          ))}
        </ul>
      );
      key += 1;
      continue;
    }

    if (isOrdered(line)) {
      const items: string[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`md-ol-${key}`} className="list-decimal space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={`md-ol-${key}-li-${idx}`}>{renderInlineMarkdown(item, `md-ol-${key}-li-${idx}`)}</li>
          ))}
        </ol>
      );
      key += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i])) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`md-p-${key}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(paragraphLines.join('\n'), `md-p-${key}`)}
      </p>
    );
    key += 1;
  }

  return blocks;
}

function renderConcentrationText(text: string, visibleChars: number, keyPrefix: string) {
  const chars = Array.from(text);
  return chars.map((char, index) => (
    <span
      key={`${keyPrefix}-char-${index}`}
      className={`transition-opacity duration-300 ease-out ${
        index < visibleChars ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {char}
    </span>
  ));
}

function normalizeError(error: unknown): UiError {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 502 || error.status === 503) {
      return {
        message: 'Сервер пока не запущен. Запустите backend и попробуйте снова.'
      };
    }

    if (error.code === 'UNSUPPORTED_MEDIA_TYPE') {
      return {
        message: 'Поддерживаются только PDF, DOC, DOCX, TXT и MD.'
      };
    }

    if (error.code === 'DOCUMENT_NOT_READY') {
      return {
        message: 'Документ ещё обрабатывается. Подождите завершения индексации.'
      };
    }

    if (error.status >= 500) {
      return {
        message: 'Сервер вернул ошибку или не успел ответить. Повторите чуть позже.'
      };
    }

    return {
      message: error.message
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return {
    message: 'Произошла непредвиденная ошибка.'
  };
}

function formatStatus(status: UploadState) {
  if (status === 'idle') return 'Файл не загружен';
  if (status === 'uploading') return 'Загружаем файл';
  if (status === 'processing') return 'Обрабатываем документ';
  if (status === 'indexed') return 'Документ готов к вопросам';
  return 'Ошибка обработки';
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function isDocumentIndexed(status?: string) {
  return status === 'indexed';
}

function readStoredNumber(key: string): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseProjectTimestamp(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortProjectsByUpdated(items: Project[]): Project[] {
  return [...items].sort((a, b) => {
    const aTs = parseProjectTimestamp(a.updated_at) || parseProjectTimestamp(a.created_at);
    const bTs = parseProjectTimestamp(b.updated_at) || parseProjectTimestamp(b.created_at);
    if (bTs !== aTs) return bTs - aTs;
    return a.id - b.id;
  });
}

export default function HomePage() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');

  const [projectId, setProjectId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [isProjectCreateInputOpen, setIsProjectCreateInputOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [contradictionJobs, setContradictionJobs] = useState<ContradictionJob[]>([]);
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [contradictionBaseDocId, setContradictionBaseDocId] = useState<number | null>(null);
  const [contradictionTargetDocIds, setContradictionTargetDocIds] = useState<number[]>([]);
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>([]);
  const [deletingDocumentIds, setDeletingDocumentIds] = useState<number[]>([]);

  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [activeUploadName, setActiveUploadName] = useState('');
  const [uploadBatchProgress, setUploadBatchProgress] = useState<UploadBatchProgress | null>(null);

  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [uiError, setUiError] = useState<UiError | null>(null);

  const [headerVisible, setHeaderVisible] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>('files');
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);

  const [uploadBlockedUntil, setUploadBlockedUntil] = useState<number | null>(null);
  const [queryBlockedUntil, setQueryBlockedUntil] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const [isDragActive, setIsDragActive] = useState(false);
  const [flyingMessage, setFlyingMessage] = useState<FlyingMessage | null>(null);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);
  const [isProjectsSectionCollapsed, setIsProjectsSectionCollapsed] = useState(false);
  const [scrollOnSendTick, setScrollOnSendTick] = useState(0);
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());

  const toggleCitation = useCallback((key: string) => {
    setExpandedCitations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const lastScrollY = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerFieldRef = useRef<HTMLDivElement | null>(null);
  const messageBubbleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollAnimationRef = useRef<number | null>(null);
  const scrollKickoffFrameRef = useRef<number | null>(null);
  const scrollFollowUpTimeoutRef = useRef<number | null>(null);
  const flyingMessageResolveRef = useRef<Record<string, () => void>>({});
  const activeProjectIdRef = useRef<number | null>(null);

  const touchStartXRef = useRef<number | null>(null);
  const touchCurrentXRef = useRef<number | null>(null);

  const indexedDocuments = useMemo(
    () => documents.filter((doc) => isDocumentIndexed(doc.status)),
    [documents]
  );

  const selectedIndexedDocuments = useMemo(
    () => indexedDocuments.filter((doc) => selectedDocumentIds.includes(doc.id)),
    [indexedDocuments, selectedDocumentIds]
  );

  const effectiveTargetDocumentIds = useMemo(() => {
    return selectedIndexedDocuments.length > 0
      ? selectedIndexedDocuments.map((doc) => doc.id)
      : undefined;
  }, [selectedIndexedDocuments]);

  const allIndexedSelected = useMemo(() => {
    return (
      indexedDocuments.length > 0 &&
      indexedDocuments.every((doc) => selectedDocumentIds.includes(doc.id))
    );
  }, [indexedDocuments, selectedDocumentIds]);

  const scopeLabel = useMemo(() => {
    if (selectedIndexedDocuments.length > 0) {
      if (selectedIndexedDocuments.length === 1) {
        return `Поиск по файлу: ${selectedIndexedDocuments[0].name}`;
      }

      return `Поиск по выбранным файлам: ${selectedIndexedDocuments.length}`;
    }

    if (indexedDocuments.length > 0) {
      return `Поиск по всем файлам: ${indexedDocuments.length}`;
    }

    return 'Нет готовых документов';
  }, [indexedDocuments, selectedIndexedDocuments]);

  const hasFirstUserMessage = useMemo(
    () => messages.some((item) => item.role === 'user'),
    [messages]
  );

  const shouldShowProjectSearch = projects.length > 10;
  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLocaleLowerCase();
    if (!query) return projects;
    return projects.filter((project) => project.name.toLocaleLowerCase().includes(query));
  }, [projectSearchQuery, projects]);

  const isUploadBlocked = Boolean(uploadBlockedUntil && uploadBlockedUntil > nowTs);
  const isQueryBlocked = Boolean(queryBlockedUntil && queryBlockedUntil > nowTs);
  const maxFilesReached = documents.length >= MAX_FILES_PER_PROJECT;

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const shouldDark =
        themeMode === 'dark' ||
        (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', shouldDark);
    };

    apply();

    if (themeMode === 'system') {
      mediaQuery.addEventListener('change', apply);
      return () => mediaQuery.removeEventListener('change', apply);
    }
  }, [themeMode]);

  useEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    const onScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;

      if (currentY < 24) {
        setHeaderVisible(true);
      } else if (delta > 6) {
        setHeaderVisible(false);
      } else if (delta < -6) {
        setHeaderVisible(true);
      }

      lastScrollY.current = currentY;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!isRightPanelOpen) {
      touchStartXRef.current = null;
      touchCurrentXRef.current = null;
      return;
    }

    if (window.matchMedia('(min-width: 1024px)').matches) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isRightPanelOpen]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNowTs(Date.now());
    }, 30000);

    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!uploadBatchProgress?.active) return;

    const tick = window.setInterval(() => {
      setNowTs(Date.now());
    }, 120);

    return () => window.clearInterval(tick);
  }, [uploadBatchProgress?.active]);

  useEffect(() => {
    if (rightPanelView !== 'contradiction' || !projectId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await ragApi.listAnalysisJobs(projectId);
        if (cancelled) return;
        const jobs: ContradictionJob[] = res.items.map((item) => ({
          id: item.id,
          status: item.status as ContradictionJob['status'],
          baseDocumentId: item.base_document_id,
          targetDocumentIds: item.target_document_ids || [],
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          result: item.results
        }));
        setContradictionJobs(jobs);
      } catch {}
    };
    load();
    const poll = window.setInterval(async () => {
      if (!projectId) return;
      try {
        const res = await ragApi.listAnalysisJobs(projectId);
        if (cancelled) return;
        const jobs: ContradictionJob[] = res.items.map((item) => ({
          id: item.id,
          status: item.status as ContradictionJob['status'],
          baseDocumentId: item.base_document_id,
          targetDocumentIds: item.target_document_ids || [],
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          result: item.results
        }));
        setContradictionJobs(jobs);
      } catch {}
    }, 5000);
    return () => { cancelled = true; window.clearInterval(poll); };
  }, [rightPanelView, projectId]);

  useEffect(() => {
    setUploadBlockedUntil(readStoredNumber(STORAGE_KEYS.uploadBlockedUntil));
    setQueryBlockedUntil(readStoredNumber(STORAGE_KEYS.queryBlockedUntil));
  }, []);

  useEffect(() => {
    if (!uploadBlockedUntil || uploadBlockedUntil > nowTs) return;
    setUploadBlockedUntil(null);
    window.localStorage.removeItem(STORAGE_KEYS.uploadBlockedUntil);
  }, [nowTs, uploadBlockedUntil]);

  useEffect(() => {
    if (!queryBlockedUntil || queryBlockedUntil > nowTs) return;
    setQueryBlockedUntil(null);
    window.localStorage.removeItem(STORAGE_KEYS.queryBlockedUntil);
  }, [nowTs, queryBlockedUntil]);

  const animateScrollToBottom = useCallback((duration = CHAT_SCROLL_DURATION_MS) => {
    const target = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const start = window.scrollY;
    const delta = target - start;

    if (Math.abs(delta) < 2) return;

    if (scrollAnimationRef.current != null) {
      window.cancelAnimationFrame(scrollAnimationRef.current);
    }

    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 2);
      window.scrollTo({ top: start + delta * eased });

      if (progress < 1) {
        scrollAnimationRef.current = window.requestAnimationFrame(step);
      } else {
        scrollAnimationRef.current = null;
      }
    };

    scrollAnimationRef.current = window.requestAnimationFrame(step);
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollAnimationRef.current != null) {
      window.cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = null;
    }
    if (scrollKickoffFrameRef.current != null) {
      window.cancelAnimationFrame(scrollKickoffFrameRef.current);
      scrollKickoffFrameRef.current = null;
    }
    if (scrollFollowUpTimeoutRef.current != null) {
      window.clearTimeout(scrollFollowUpTimeoutRef.current);
      scrollFollowUpTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (scrollOnSendTick === 0 || !hasFirstUserMessage) return;
    scrollKickoffFrameRef.current = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      animateScrollToBottom();
      scrollKickoffFrameRef.current = null;
    });
    scrollFollowUpTimeoutRef.current = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      animateScrollToBottom();
      scrollFollowUpTimeoutRef.current = null;
    }, CHAT_SCROLL_SECOND_PASS_DELAY_MS);

    return stopAutoScroll;
  }, [animateScrollToBottom, hasFirstUserMessage, scrollOnSendTick, stopAutoScroll]);

  useEffect(() => {
    const onUserScrollIntent = () => {
      stopAutoScroll();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageUp' ||
        event.key === 'PageDown' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === ' '
      ) {
        stopAutoScroll();
      }
    };

    window.addEventListener('wheel', onUserScrollIntent, { passive: true });
    window.addEventListener('touchmove', onUserScrollIntent, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('wheel', onUserScrollIntent);
      window.removeEventListener('touchmove', onUserScrollIntent);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [stopAutoScroll]);

  useEffect(() => {
    if (!uiError) return;
    const timeout = window.setTimeout(() => {
      setUiError(null);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [uiError]);

  useEffect(() => {
    const payload = documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      size_bytes: doc.size_bytes,
      status: doc.status
    }));

    window.localStorage.setItem(STORAGE_KEYS.uploadedDocumentMeta, JSON.stringify(payload));
  }, [documents]);

  useEffect(() => {
    return stopAutoScroll;
  }, [stopAutoScroll]);

  const triggerFlyingMessage = useCallback((text: string, targetMessageId: string) => {
    const composerRect = composerFieldRef.current?.getBoundingClientRect();
    if (!composerRect) return Promise.resolve();

    const bubbleWidth = Math.max(150, Math.min(320, composerRect.width - 20));
    const bubbleHeight = 40;
    const fullHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const distanceToBottom = fullHeight - (window.scrollY + window.innerHeight);
    const shouldStartBelowComposer = distanceToBottom > 8;
    const start = {
      left: composerRect.right - bubbleWidth - 10,
      top: shouldStartBelowComposer ? composerRect.bottom + 8 : composerRect.top + 8,
      width: bubbleWidth,
      height: bubbleHeight
    };

    const animationId = crypto.randomUUID();

    return new Promise<void>((resolve) => {
      flyingMessageResolveRef.current[animationId] = resolve;

      setFlyingMessage({
        id: animationId,
        targetMessageId,
        text,
        start,
        end: start,
        phase: 'start'
      });
    });
  }, []);

  useEffect(() => {
    if (!flyingMessage || flyingMessage.phase !== 'start') return;

    let frame = 0;

    const resolveTarget = () => {
      const target = messageBubbleRefs.current[flyingMessage.targetMessageId];
      if (!target) {
        frame = window.requestAnimationFrame(resolveTarget);
        return;
      }

      const targetRect = target.getBoundingClientRect();
      setFlyingMessage((prev) =>
        prev && prev.id === flyingMessage.id
          ? {
              ...prev,
              start: {
                ...prev.start,
                top:
                  composerFieldRef.current &&
                  targetRect.top > composerFieldRef.current.getBoundingClientRect().bottom
                    ? composerFieldRef.current.getBoundingClientRect().bottom + 8
                    : prev.start.top,
                width: targetRect.width,
                height: targetRect.height
              },
              end: {
                left: targetRect.left,
                top: targetRect.top,
                width: targetRect.width,
                height: targetRect.height
              },
              phase: 'end'
            }
          : prev
      );
    };

    frame = window.requestAnimationFrame(resolveTarget);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [flyingMessage]);

  useEffect(() => {
    if (!flyingMessage || flyingMessage.phase !== 'end') return;
    const timeout = window.setTimeout(() => {
      const onArrive = flyingMessageResolveRef.current[flyingMessage.id];
      if (onArrive) {
        onArrive();
        delete flyingMessageResolveRef.current[flyingMessage.id];
      }

      setFlyingMessage((prev) =>
        prev?.id === flyingMessage.id
          ? {
              ...prev,
              phase: 'fade'
            }
          : prev
      );
    }, FLYING_MESSAGE_MOVE_MS);

    return () => window.clearTimeout(timeout);
  }, [flyingMessage]);

  useEffect(() => {
    if (!flyingMessage || flyingMessage.phase !== 'fade') return;
    const timeout = window.setTimeout(() => {
      setFlyingMessage((prev) => (prev?.id === flyingMessage.id ? null : prev));
    }, FLYING_MESSAGE_FADE_MS);

    return () => window.clearTimeout(timeout);
  }, [flyingMessage]);

  useEffect(() => {
    return () => {
      const entries = Object.values(flyingMessageResolveRef.current);
      entries.forEach((resolve) => resolve());
      flyingMessageResolveRef.current = {};
    };
  }, []);

  const clearProjectScopedState = useCallback(() => {
    setDocuments([]);
    setContradictionJobs([]);
    setContradictionBaseDocId(null);
    setContradictionTargetDocIds([]);
    setMessages([]);
    setQuestion('');
    setSelectedDocumentIds([]);
    setDocumentPreview(null);
    setRightPanelView('files');
    setUploadState('idle');
    setActiveUploadName('');
    setUploadBatchProgress(null);
  }, []);

  const refreshDocuments = useCallback(async (targetProjectId: number) => {
    const list = await ragApi.listDocuments(targetProjectId, 1, 100);
    if (activeProjectIdRef.current !== targetProjectId) return;
    setDocuments(list.items);

    setSelectedDocumentIds((prev) =>
      prev.filter((id) =>
        list.items.some((doc) => doc.id === id && isDocumentIndexed(doc.status))
      )
    );
  }, []);

  const startContradictionAnalysis = useCallback(async (baseDocumentId: number, targetDocumentIds: number[]) => {
    if (!projectId) return;
    
    try {
      const response = await ragApi.startContradictionAnalysis(projectId, {
        base_document_id: baseDocumentId,
        target_document_ids: targetDocumentIds
      });
      
      // Add the new job to the list
      const newJob: ContradictionJob = {
        id: response.job_id,
        status: response.status,
        baseDocumentId,
        targetDocumentIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        result: undefined
      };
      
      setContradictionJobs(prev => [newJob, ...prev]);
      return response;
    } catch (error) {
      setUiError(normalizeError(error));
      throw error;
    }
  }, [projectId]);

  const refreshProjects = useCallback(async () => {
    setIsProjectsLoading(true);
    try {
      const response = await ragApi.listProjects(1, 100);
      const sorted = sortProjectsByUpdated(response.items);
      setProjects(sorted);
      setProjectId((prev) => (prev && sorted.some((project) => project.id === prev) ? prev : sorted[0]?.id ?? null));
      return sorted;
    } finally {
      setIsProjectsLoading(false);
    }
  }, []);

  const switchProject = useCallback(
    (nextProjectId: number) => {
      if (projectId === nextProjectId) return;
      clearProjectScopedState();
      setUiError(null);
      setProjectId(nextProjectId);
    },
    [clearProjectScopedState, projectId]
  );

  const createProjectInline = useCallback(async () => {
    const name = projectNameDraft.trim();
    if (!name || isCreatingProject) return;

    try {
      setIsCreatingProject(true);
      const created = await ragApi.createProject({ name });
      setUiError(null);
      setProjectNameDraft('');
      setIsProjectCreateInputOpen(false);
      setProjectSearchQuery('');
      clearProjectScopedState();
      setProjects((prev) => sortProjectsByUpdated([created, ...prev]));
      setProjectId(created.id);
    } catch (error) {
      setUiError(normalizeError(error));
      } finally {
        setIsCreatingProject(false);
      }
    }, [clearProjectScopedState, isCreatingProject, projectNameDraft]);

  const confirmProjectDelete = useCallback(async () => {
    if (!projectPendingDelete || deletingProjectId != null) return;

    const projectToDelete = projectPendingDelete;
    const snapshot = projects;
    const deletedIndex = snapshot.findIndex((project) => project.id === projectToDelete.id);
    const nextProjectCandidate = deletedIndex >= 0 ? snapshot[deletedIndex + 1]?.id ?? null : null;

    try {
      setDeletingProjectId(projectToDelete.id);
      await ragApi.deleteProject(projectToDelete.id);
      setUiError(null);

      const remainingProjects = sortProjectsByUpdated(
        snapshot.filter((project) => project.id !== projectToDelete.id)
      );
      setProjects(remainingProjects);

      if (projectId === projectToDelete.id) {
        clearProjectScopedState();
        const nextProjectId =
          nextProjectCandidate && remainingProjects.some((project) => project.id === nextProjectCandidate)
            ? nextProjectCandidate
            : remainingProjects[0]?.id ?? null;
        setProjectId(nextProjectId);
      }
    } catch (error) {
      setUiError(normalizeError(error));
    } finally {
      setDeletingProjectId(null);
      setProjectPendingDelete(null);
    }
    }, [clearProjectScopedState, deletingProjectId, projectId, projectPendingDelete, projects]);

  const checkServer = useCallback(async () => {
    setServerStatus('checking');

    try {
      await ragApi.ping();
      setServerStatus('online');
      setUiError(null);
    } catch (error) {
      setServerStatus('offline');
      setUiError(normalizeError(error));
    }
  }, []);

  useEffect(() => {
    void checkServer();
  }, [checkServer]);

  useEffect(() => {
    const init = async () => {
      try {
        await refreshProjects();
      } catch (error) {
        setUiError(normalizeError(error));
      }
    };

    void init();
  }, [refreshProjects]);

  useEffect(() => {
    if (!projectId) {
      setDocuments([]);
      setSelectedDocumentIds([]);
      return;
    }

    const load = async () => {
      try {
        await refreshDocuments(projectId);
      } catch (error) {
        setUiError(normalizeError(error));
      }
    };

    void load();
  }, [projectId, refreshDocuments]);

  const pollUntilIndexed = useCallback(
    async (
      currentProjectId: number,
      currentDocumentId: number,
      syncUiUploadState = true
    ) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < 90000) {
        const fresh = await ragApi.getDocument(currentProjectId, currentDocumentId);

        if (fresh.status === 'indexed') {
          if (syncUiUploadState) {
            setUploadState('indexed');
          }
          await refreshDocuments(currentProjectId);
          return;
        }

        if (fresh.status === 'failed') {
          if (syncUiUploadState) {
            setUploadState('error');
          }
          await refreshDocuments(currentProjectId);
          throw new Error('Обработка документа завершилась ошибкой.');
        }

        if (syncUiUploadState) {
          setUploadState('processing');
        }
        await wait(1200);
      }

      if (syncUiUploadState) {
        setUploadState('error');
      }
      await refreshDocuments(currentProjectId);
      throw new Error('Таймаут обработки документа.');
    },
    [refreshDocuments]
  );

  const blockUploadsForDay = useCallback(() => {
    const blockedUntil = Date.now() + BLOCK_DURATION_MS;
    setUploadBlockedUntil(blockedUntil);
    window.localStorage.setItem(STORAGE_KEYS.uploadBlockedUntil, String(blockedUntil));
  }, []);

  const blockQueriesForDay = useCallback(() => {
    const blockedUntil = Date.now() + BLOCK_DURATION_MS;
    setQueryBlockedUntil(blockedUntil);
    window.localStorage.setItem(STORAGE_KEYS.queryBlockedUntil, String(blockedUntil));
  }, []);

  const handleFiles = useCallback(
    async (incomingFiles: FileList | File[]) => {
      const files = Array.from(incomingFiles);

      if (files.length === 0) return;

      if (isUploadBlocked && uploadBlockedUntil) {
        setUiError({
          message: `Загрузка временно заблокирована до ${formatDateTime(uploadBlockedUntil)}.`
        });
        return;
      }

      if (maxFilesReached) {
        setUiError({
          message: `В проекте уже ${MAX_FILES_PER_PROJECT} файла. Удалите один файл, чтобы загрузить новый.`
        });
        return;
      }

      const rejectedMessages: string[] = [];
      const validFiles: File[] = [];

      files.forEach((file) => {
        if (!isAllowedFile(file)) {
          rejectedMessages.push(`${file.name}: неподдерживаемый формат.`);
          return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          rejectedMessages.push(`${file.name}: размер больше ${MAX_FILE_SIZE_MB} MB.`);
          return;
        }

        validFiles.push(file);
      });

      const availableSlots = Math.max(0, MAX_FILES_PER_PROJECT - documents.length);
      const filesToUpload = validFiles.slice(0, availableSlots);

      if (validFiles.length > availableSlots) {
        validFiles.slice(availableSlots).forEach((file) => {
          rejectedMessages.push(`${file.name}: превышен лимит ${MAX_FILES_PER_PROJECT} файла в проекте.`);
        });
      }

      if (rejectedMessages.length > 0) {
        setUiError({ message: `Часть файлов пропущена: ${rejectedMessages.join(' ')}` });
      }

      if (filesToUpload.length === 0) {
        return;
      }

      if (!projectId) {
        setUiError({ message: 'Сначала создайте проект и выберите его в левой панели.' });
        return;
      }

      try {
        const currentProjectId = projectId;
        setUploadBatchProgress({
          total: filesToUpload.length,
          completed: 0,
          failed: 0,
          active: true,
          stepStartedAt: Date.now()
        });
        setUploadState('uploading');
        setActiveUploadName(
          filesToUpload.length > 1 ? `${filesToUpload.length} файлов` : filesToUpload[0]?.name ?? ''
        );

        const uploadTasks = filesToUpload.map((file) => async () => {
          try {
            const uploaded = await ragApi.uploadDocument(currentProjectId, file);
            setUploadState('processing');
            await pollUntilIndexed(currentProjectId, uploaded.id, false);
            return { ok: true as const };
          } catch (error) {
            return { ok: false as const, error };
          } finally {
            setUploadBatchProgress((prev) =>
              prev
                ? {
                    ...prev,
                    completed: prev.completed + 1,
                    stepStartedAt: Date.now()
                  }
                : prev
            );
          }
        });

        const results = await runWithConcurrency(uploadTasks, MAX_PARALLEL_UPLOADS);
        const failures = results.filter(
          (result): result is { ok: false; error: unknown } => !result.ok
        );

        if (failures.length > 0) {
          const hasRateLimit = failures.some(
            (result) => result.error instanceof ApiError && result.error.status === 429
          );

          if (hasRateLimit) {
            blockUploadsForDay();
          }

          setUploadState('error');
          setUploadBatchProgress(null);
          setUiError(normalizeError(failures[0]?.error));
        } else {
          setUploadState('indexed');
          setUploadBatchProgress(null);
        }

        setActiveUploadName('');
        await refreshDocuments(currentProjectId);
        await refreshProjects();
      } catch (error) {
        setUploadState('error');
        setUploadBatchProgress(null);

        if (error instanceof ApiError && error.status === 429) {
          blockUploadsForDay();
        }

        setUiError(normalizeError(error));
      }
    },
    [
      blockUploadsForDay,
      documents.length,
      isUploadBlocked,
      maxFilesReached,
      pollUntilIndexed,
      projectId,
      refreshDocuments,
      refreshProjects,
      uploadBlockedUntil
    ]
  );

  const deleteDocument = useCallback(
    async (doc: Document) => {
      if (!projectId) return;

      setDeletingDocumentIds((prev) => (prev.includes(doc.id) ? prev : [...prev, doc.id]));

      try {
        await ragApi.deleteDocument(projectId, doc.id);
        setUiError(null);

        if (documentPreview?.documentId === doc.id) {
          setDocumentPreview(null);
          setRightPanelView('files');
        }

        await refreshDocuments(projectId);
        await refreshProjects();
      } catch (error) {
        setUiError(normalizeError(error));
      } finally {
        setDeletingDocumentIds((prev) => prev.filter((id) => id !== doc.id));
      }
    },
    [documentPreview?.documentId, projectId, refreshDocuments, refreshProjects]
  );

  const openDocumentPreview = useCallback(
    async (documentId: number, documentName: string, highlightSnippet?: string) => {
      if (!projectId) {
        setUiError({ message: 'Проект ещё не готов. Попробуйте через секунду.' });
        return;
      }

      const localDoc = documents.find((doc) => doc.id === documentId);
      if (localDoc && !isDocumentIndexed(localDoc.status)) {
        setUiError({ message: 'Документ ещё обрабатывается. Текст пока недоступен.' });
        return;
      }

      setIsRightPanelOpen(true);
      setRightPanelView('document');
      setDocumentPreview({
        documentId,
        documentName,
        text: '',
        status: 'loading',
        highlightSnippet
      });

      try {
        const result = await ragApi.getDocumentText(projectId, documentId);

        setDocumentPreview({
          documentId,
          documentName,
          text: result.text,
          status: 'ready',
          highlightSnippet
        });
      } catch (error) {
        const normalized = normalizeError(error);

        setDocumentPreview({
          documentId,
          documentName,
          text: '',
          status: 'error',
          errorMessage: normalized.message,
          highlightSnippet
        });
      }
    },
    [documents, projectId]
  );

  const toggleDocument = useCallback((documentId: number) => {
    setSelectedDocumentIds((prev) =>
      prev.includes(documentId)
        ? prev.filter((id) => id !== documentId)
        : [...prev, documentId]
    );
  }, []);

  const toggleAllIndexed = useCallback(() => {
    if (indexedDocuments.length === 0) return;

    setSelectedDocumentIds((prev) => {
      const areAllSelected = indexedDocuments.every((doc) => prev.includes(doc.id));

      if (areAllSelected) {
        return prev.filter((id) => !indexedDocuments.some((doc) => doc.id === id));
      }

      const next = new Set(prev);
      indexedDocuments.forEach((doc) => next.add(doc.id));
      return Array.from(next);
    });
  }, [indexedDocuments]);

  const handleSidebarTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    touchCurrentXRef.current = event.touches[0]?.clientX ?? null;
  }, []);

  const handleSidebarTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    touchCurrentXRef.current = event.touches[0]?.clientX ?? null;
  }, []);

  const handleSidebarTouchEnd = useCallback(() => {
    if (touchStartXRef.current == null || touchCurrentXRef.current == null) {
      return;
    }

    const deltaX = touchCurrentXRef.current - touchStartXRef.current;

    if (rightPanelView === 'files' && deltaX < -60) {
      setIsRightPanelOpen(false);
    }

    if (rightPanelView === 'document' && deltaX > 60) {
      setIsRightPanelOpen(false);
    }

    touchStartXRef.current = null;
    touchCurrentXRef.current = null;
  }, [rightPanelView]);

  const askQuestion = useCallback(async () => {
    if (!question.trim() || !projectId || indexedDocuments.length === 0 || isSending || isQueryBlocked) return;

    const userText = question.trim();
    const userMessageId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setQuestion('');

    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      text: userText,
      scopeLabel,
      isPendingAppearance: true
    };

    setUiError(null);
    setIsSending(true);
    setMessages((prev) => [...prev, userMessage]);

    await triggerFlyingMessage(userText, userMessageId);

    setMessages((prev) => {
      const withVisibleUser = prev.map((message) =>
        message.id === userMessageId && message.role === 'user'
          ? {
              ...message,
              isPendingAppearance: false
            }
          : message
      );

      return [
        ...withVisibleUser,
        {
          id: assistantId,
          role: 'assistant',
          text: '',
          citations: [],
          confidence: 0,
          isStreaming: true
        }
      ];
    });
    setScrollOnSendTick((prev) => prev + 1);

    try {
      const response = await ragApi.queryRag(projectId, {
        question: userText,
        target_document_ids: effectiveTargetDocumentIds
      });

      if (!response.answer?.trim()) {
        throw new Error('Модель вернула пустой ответ.');
      }

      const finalText = response.answer;
      const finalConfidence = buildConfidence(response.citations.length);

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId && message.role === 'assistant'
            ? {
                ...message,
                text: finalText,
                citations: response.citations,
                confidence: finalConfidence,
                warning: response.warning_message,
                isStreaming: true,
                streamRevealChars: 0
              }
            : message
        )
      );

      await streamReveal(finalText.length, (visibleChars) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId && message.role === 'assistant'
              ? {
                  ...message,
                  text: finalText,
                  citations: response.citations,
                  confidence: finalConfidence,
                  warning: response.warning_message,
                  isStreaming: true,
                  streamRevealChars: visibleChars
                }
              : message
          )
        );
      });

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId && message.role === 'assistant'
            ? {
                ...message,
                text: finalText,
                citations: response.citations,
                confidence: finalConfidence,
                warning: response.warning_message,
                isStreaming: false,
                streamRevealChars: undefined
              }
            : message
        )
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        blockQueriesForDay();
      }

      const normalized = normalizeError(error);
      setUiError(normalized);
      setMessages((prev) => prev.filter((message) => message.id !== assistantId));
    } finally {
      setIsSending(false);
    }
  }, [
    blockQueriesForDay,
    effectiveTargetDocumentIds,
    indexedDocuments.length,
    isQueryBlocked,
    isSending,
    projectId,
    question,
    scopeLabel,
    triggerFlyingMessage
  ]);

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      await askQuestion();
    },
    [askQuestion]
  );

  useEffect(() => {
    const hasFiles = (event: DragEvent) => {
      return Array.from(event.dataTransfer?.types ?? []).includes('Files');
    };

    let dragCounter = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounter += 1;
      setIsDragActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setIsDragActive(true);
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        setIsDragActive(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounter = 0;
      setIsDragActive(false);

      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        void handleFiles(files);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);


  const emptyState = messages.length === 0;
  const isLiveOffline = serverStatus === 'offline';
  const noReadyDocs = indexedDocuments.length === 0;
  const uploadInProgress = uploadState === 'uploading' || uploadState === 'processing';
  const uploadDisabled =
    !projectId || isUploadBlocked || uploadInProgress || maxFilesReached || isLiveOffline;
  const sendDisabled = isSending || !question.trim() || noReadyDocs || isLiveOffline || isQueryBlocked;
  const canOpenUploadFromHints = Boolean(projectId) && !uploadDisabled;
  const isDesktopDocumentPanelOpen = isRightPanelOpen && rightPanelView === 'document';
  const isAnyPanelOpen = isRightPanelOpen && (rightPanelView === 'document' || rightPanelView === 'contradiction');
  const isMobileFilesPanelOpen = isRightPanelOpen && rightPanelView === 'files';
  const isDocumentPanelOpen = isRightPanelOpen && rightPanelView === 'document';
  const shouldCenterComposer = !hasFirstUserMessage;
  const showDesktopSidebar = !isAnyPanelOpen && !isDesktopSidebarCollapsed;
  const uploadBatchPercent = useMemo(() => {
    if (!uploadBatchProgress || uploadBatchProgress.total <= 0) return 0;
    const exact = (uploadBatchProgress.completed / uploadBatchProgress.total) * 100;
    if (!uploadBatchProgress.active) {
      return Math.min(100, Math.round(exact));
    }

    const stepWidth = 100 / uploadBatchProgress.total;
    const elapsedInStep = Math.max(0, nowTs - uploadBatchProgress.stepStartedAt);
    const optimisticPart = Math.min(stepWidth * 0.88, (elapsedInStep / 11000) * stepWidth);
    return Math.min(99, Math.round(exact + optimisticPart));
  }, [nowTs, uploadBatchProgress]);
  const showUploadBatchProgress = Boolean(
    uploadBatchProgress && uploadBatchProgress.active
  );
  const documentPreviewHighlightRange = useMemo(() => {
    if (!documentPreview || documentPreview.status !== 'ready') return null;
    return findSnippetRange(documentPreview.text, documentPreview.highlightSnippet);
  }, [documentPreview]);

  const openFilesPanelFromHeader = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      if (isDesktopSidebarCollapsed) {
        setIsDesktopSidebarCollapsed(false);
        return;
      }

      if (isAnyPanelOpen) {
        setIsRightPanelOpen(false);
      }

      return;
    }

    setRightPanelView('files');
    setIsRightPanelOpen(true);
  }, [isAnyPanelOpen, isDesktopSidebarCollapsed]);

  const renderSidebarContent = (variant: 'desktop' | 'mobile') => (
    <div className={`flex h-full min-h-0 flex-col ${variant === 'desktop' ? 'bg-[var(--bg)]' : 'bg-[var(--bg)]'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
        <div className="flex items-center gap-2">
          <p className="text-base font-semibold">Проекты</p>
          <button
            type="button"
            onClick={() => setIsProjectsSectionCollapsed((prev) => !prev)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--muted)] transition hover:text-[var(--text)]"
            aria-label={isProjectsSectionCollapsed ? 'Развернуть проекты' : 'Свернуть проекты'}
            title={isProjectsSectionCollapsed ? 'Развернуть проекты' : 'Свернуть проекты'}
          >
            {isProjectsSectionCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
        {variant === 'desktop' ? (
          <button
            type="button"
            onClick={() => setIsDesktopSidebarCollapsed(true)}
            className="hidden rounded-xl border border-[var(--line)] p-2 text-[var(--muted)] transition hover:text-[var(--text)] lg:inline-flex"
            aria-label="Скрыть блок файлов"
            title="Скрыть блок файлов"
          >
            <ChevronLeft size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsRightPanelOpen(false)}
            className="inline-flex rounded-xl border border-[var(--line)] p-2 text-[var(--muted)]"
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          className={`overflow-hidden transition-[max-height,opacity] duration-300 ${
            isProjectsSectionCollapsed ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-[1000px] opacity-100'
          }`}
        >
          <div className="space-y-3 border-[var(--line)] px-4 py-3">
            {shouldShowProjectSearch ? (
              <input
                value={projectSearchQuery}
                onChange={(event) => setProjectSearchQuery(event.target.value)}
                placeholder="Поиск проекта..."
                className="w-full rounded-xl border border-[var(--line)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)]/40 placeholder:text-[var(--muted)]"
              />
            ) : null}

            <div
              className={`${shouldShowProjectSearch ? 'max-h-52 overflow-y-auto pr-1' : ''} project-sublist-scroll space-y-1`}
            >
              {isProjectsLoading ? (
                <p className="px-2 py-2 text-sm text-[var(--muted)]">Загружаем проекты...</p>
              ) : filteredProjects.length === 0 ? (
                <p className="px-2 py-2 text-sm text-[var(--muted)]">
                  {projects.length === 0 ? 'Проектов пока нет.' : 'Проекты не найдены.'}
                </p>
              ) : (
                filteredProjects.map((project) => {
                  const isCurrent = project.id === projectId;
                  const isDeletingProject = deletingProjectId === project.id;

                  return (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => switchProject(project.id)}
                      className={`project-item group flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left ${
                        isCurrent ? 'project-item-active' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text)]">
                          {project.name} ({project.document_count} файлов)
                        </p>
                      </div>

                      <div
                        className={`flex items-center gap-1 transition-opacity ${
                          variant === 'mobile' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(event) => event.stopPropagation()}
                          disabled
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--muted)] opacity-50"
                          aria-label="Переименовать проект (пока недоступно)"
                          title="Переименование пока недоступно"
                        >
                          <PenSquare size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setProjectPendingDelete(project);
                          }}
                          disabled={isDeletingProject}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-400/35 text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Удалить проект ${project.name}`}
                          title="Удалить проект"
                        >
                          {isDeletingProject ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {isProjectCreateInputOpen ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createProjectInline();
                }}
              >
                <input
                  value={projectNameDraft}
                  onChange={(event) => setProjectNameDraft(event.target.value)}
                  placeholder="Название проекта"
                  autoFocus
                  maxLength={200}
                  className="w-full rounded-xl border border-[var(--line)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)]/40 placeholder:text-[var(--muted)]"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={isCreatingProject || !projectNameDraft.trim()}
                    className="rounded-lg border border-[var(--line)] bg-[var(--accent)]/15 px-3 py-1.5 text-xs font-medium text-[var(--text)] transition hover:border-[var(--accent)]/45 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCreatingProject ? 'Создаем...' : 'Создать'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectNameDraft('');
                      setIsProjectCreateInputOpen(false);
                    }}
                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--text)]"
                  >
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsProjectCreateInputOpen(true)}
                className="w-full rounded-xl border border-dashed border-[var(--line)] px-3 py-2 text-left text-sm text-[var(--muted)] transition hover:border-[var(--accent)]/35 hover:text-[var(--text)]"
              >
                + Создать проект
              </button>
            )}
          </div>
        </div>

      <div className="border-b border-[var(--line)] px-4 py-3">
        <p className="text-sm font-semibold tracking-[0.08em] text-[var(--text)]/90 uppercase">Файлы проекта</p>
      </div>

      {showUploadBatchProgress && uploadBatchProgress ? (
        <div className="px-4 pt-3">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg)]/70 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
              <span className="truncate">
                {uploadBatchProgress.active
                  ? 'Загружаем файлы...'
                  : uploadBatchProgress.failed > 0
                    ? 'Загрузка завершена с ошибками'
                    : 'Загрузка завершена'}
              </span>
              <span className="shrink-0 font-medium text-[var(--text)]">
                {uploadBatchProgress.completed}/{uploadBatchProgress.total}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--line)]/65">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${Math.max(4, uploadBatchPercent)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-2 border-[var(--line)] px-4 py-3">
        <button
          type="button"
          onClick={toggleAllIndexed}
            disabled={indexedDocuments.length === 0}
            className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              allIndexedSelected
                ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                : 'border-[var(--line)] bg-[var(--bg)]/70'
            }`}
          >
            <div className="flex items-center gap-3">
              {allIndexedSelected ? (
                <CheckSquare size={18} className="text-[var(--accent)]" />
              ) : (
                <Square size={18} className="text-[var(--muted)]" />
              )}

              <div className="text-left">
                <p className="text-sm font-medium text-[var(--text)]">
                  {allIndexedSelected ? 'Снять выбор со всех' : 'Выбрать все'}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {indexedDocuments.length > 0
                    ? `Готовых файлов: ${indexedDocuments.length}`
                    : 'Нет готовых файлов'}
                </p>
              </div>
            </div>
          </button>
        </div>

      <div className="space-y-2 px-3 py-3">
        {!projectId ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm text-[var(--muted)]">
            Создайте проект, чтобы загружать и выбирать файлы.
          </div>
        ) : documents.length === 0 ? (
          <button
            type="button"
            onClick={() => {
              if (!canOpenUploadFromHints) return;
              fileInputRef.current?.click();
            }}
            disabled={!canOpenUploadFromHints}
            className={`w-full rounded-2xl border border-dashed px-4 py-5 text-left text-sm transition ${
              canOpenUploadFromHints
                ? 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/24 hover:text-[var(--text)] hover:shadow-[0_0_0_1px_rgba(63,134,255,0.35)]'
                : 'border-[var(--line)] text-[var(--muted)]/75 opacity-80'
            }`}
          >
            Здесь будут отображаться загруженные документы.
          </button>
        ) : (
          documents.map((doc) => {
              const checked = selectedDocumentIds.includes(doc.id);
              const indexed = isDocumentIndexed(doc.status);
              const isDeleting = deletingDocumentIds.includes(doc.id);

              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={indexed ? 0 : -1}
                  onClick={() => indexed && toggleDocument(doc.id)}
                  onKeyDown={(event) => {
                    if (!indexed) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleDocument(doc.id);
                    }
                  }}
                  className={`rounded-xl border px-2 py-2 transition ${
                    checked
                      ? 'border-[var(--accent)] bg-[var(--accent)]/12'
                      : 'border-[var(--line)] bg-transparent'
                  } ${!indexed ? 'opacity-75' : 'cursor-pointer hover:bg-[var(--accent)]/8'}`}
                >
                  <div className="flex items-start gap-3 rounded-xl px-2 py-1">
                    <div className="pt-0.5">
                      {checked ? (
                        <CheckSquare size={16} className="text-[var(--accent)]" />
                      ) : (
                        <Square size={16} className="text-[var(--muted)]" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-medium text-[var(--text)]">{doc.name}</p>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteDocument(doc);
                          }}
                          disabled={isDeleting}
                          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-rose-400/35 text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Удалить ${doc.name}`}
                          title="Удалить файл"
                        >
                          {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex justify-end px-2 pb-1">
              <button
                type="button"
                onClick={() => {
                  setContradictionBaseDocId(doc.id);
                  setContradictionTargetDocIds(
                    documents.filter(d => d.id !== doc.id && isDocumentIndexed(d.status)).map(d => d.id)
                  );
                  setRightPanelView('contradiction');
                  setIsRightPanelOpen(true);
                }}
                disabled={!indexed || isDeleting}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText size={13} />
                Анализ противоречий
              </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  const documentPreviewContent = (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
        <div className="min-w-0">
          <p className="text-base font-semibold">Текст документа</p>
          <p className="truncate text-sm text-[var(--muted)]">
            {documentPreview?.documentName ?? 'Документ'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsRightPanelOpen(false);
            setRightPanelView('files');
          }}
          className="relative z-10 rounded-xl border border-[var(--line)] p-2 text-[var(--muted)] transition hover:text-[var(--text)]"
          aria-label="Close document preview"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {documentPreview?.status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            <Loader2 size={16} className="mr-2 animate-spin" />
            Загружаем текст документа...
          </div>
        ) : null}

        {documentPreview?.status === 'error' ? (
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {documentPreview.errorMessage ?? 'Не удалось открыть текст документа.'}
          </div>
        ) : null}

        {documentPreview?.status === 'ready' ? (
          <article className="rounded-2xl border border-[var(--line)] bg-[var(--bg)]/60 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text)]">
              {documentPreviewHighlightRange ? (
                <>
                  {documentPreview.text.slice(0, documentPreviewHighlightRange.start)}
                  <mark className="rounded-md bg-amber-300/40 px-1 py-0.5 text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(251,191,36,0.5)]">
                    {documentPreview.text.slice(
                      documentPreviewHighlightRange.start,
                      documentPreviewHighlightRange.end
                    )}
                  </mark>
                  {documentPreview.text.slice(documentPreviewHighlightRange.end)}
                </>
              ) : (
                documentPreview.text
              )}
            </pre>
          </article>
        ) : null}
      </div>
    </div>
  );

  const renderContradictionAnalysisPanel = () => (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
        <div className="min-w-0">
          <p className="text-base font-semibold">Анализ противоречий</p>
          <p className="truncate text-sm text-[var(--muted)]">
            {contradictionJobs.length} задач
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsRightPanelOpen(false);
            setRightPanelView('files');
          }}
          className="relative z-10 rounded-xl border border-[var(--line)] p-2 text-[var(--muted)] transition hover:text-[var(--text)]"
          aria-label="Закрыть анализ противоречий"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 rounded-xl border border-[var(--line)] p-4 bg-[var(--bg)]/60">
          <p className="text-sm font-medium mb-3">Запустить новый анализ</p>

          <p className="text-xs text-[var(--muted)] mb-1">Основной документ:</p>
          <p className="text-sm font-medium mb-3">
            {contradictionBaseDocId
              ? documents.find(d => d.id === contradictionBaseDocId)?.name || `#${contradictionBaseDocId}`
              : 'Не выбран'}
          </p>

          <p className="text-xs text-[var(--muted)] mb-2">
            Документы для сравнения ({contradictionTargetDocIds.length} выбрано):
          </p>

          <div className="max-h-40 overflow-y-auto mb-4 space-y-1">
            {documents
              .filter(d => isDocumentIndexed(d.status) && d.id !== contradictionBaseDocId)
              .length === 0 ? (
              <p className="text-xs text-[var(--muted)]">Нет доступных индексированных документов.</p>
            ) : (
              documents
                .filter(d => isDocumentIndexed(d.status) && d.id !== contradictionBaseDocId)
                .map(doc => (
                  <label key={doc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--accent)]/8 rounded px-2 py-1">
                    <input
                      type="checkbox"
                      checked={contradictionTargetDocIds.includes(doc.id)}
                      onChange={() => {
                        setContradictionTargetDocIds(prev =>
                          prev.includes(doc.id)
                            ? prev.filter(id => id !== doc.id)
                            : [...prev, doc.id]
                        );
                      }}
                      className="accent-[var(--accent)]"
                    />
                    <span className="truncate">{doc.name}</span>
                  </label>
                ))
            )}
          </div>

          <button
            type="button"
            disabled={!contradictionBaseDocId || isRunningAnalysis}
            onClick={async () => {
              if (!contradictionBaseDocId) return;
              setIsRunningAnalysis(true);
              try {
                await startContradictionAnalysis(contradictionBaseDocId, contradictionTargetDocIds);
              } finally {
                setIsRunningAnalysis(false);
              }
            }}
            className="w-full rounded-xl border border-[var(--accent)] bg-[var(--accent)]/12 px-4 py-2 text-sm text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunningAnalysis ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Запуск...
              </span>
            ) : (
              'Запустить анализ противоречий'
            )}
          </button>
        </div>

        {contradictionJobs.length === 0 ? (
          <p className="text-center text-sm text-[var(--muted)]">Нет завершённых задач.</p>
        ) : (
          <ul className="space-y-4">
            {contradictionJobs.map((job) => (
              <li key={job.id} className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/60">
                <div className="flex w-full items-center justify-between p-4">
                  <button
                    type="button"
                    onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                    className="flex items-center gap-3 min-w-0 text-left flex-1"
                  >
                    <span className={`transition-transform shrink-0 ${expandedJobId === job.id ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-medium truncate">Задача #{job.id}</span>
                    <span className="text-sm text-[var(--muted)] shrink-0">
                      {documents.find(d => d.id === job.baseDocumentId)?.name || 'Неизвестно'}
                    </span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-2 py-1 text-xs ${
                      job.status === 'queued' ? 'bg-blue-500/20 text-blue-300' :
                      job.status === 'processing' ? 'bg-yellow-500/20 text-yellow-300' :
                      job.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                      'bg-red-500/20 text-red-300'
                    }`}>
                      {job.status === 'queued' ? 'Ожидает' :
                       job.status === 'processing' ? 'В обработке' :
                       job.status === 'completed' ? 'Завершена' :
                       'Ошибка'}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!projectId) return;
                        try {
                          await ragApi.deleteAnalysisJob(projectId, job.id);
                          setContradictionJobs(prev => prev.filter(j => j.id !== job.id));
                        } catch {}
                      }}
                      className="text-gray-500 hover:text-red-400 transition p-1 shrink-0"
                      title="Удалить"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                    </button>
                  </div>
                </div>
                {expandedJobId === job.id && (
                  <div className="px-4 pb-4 border-t border-[var(--line)] pt-3 space-y-3">
                    <div>
                      <span className="text-xs text-[var(--muted)]">Сравнение: </span>
                      <span className="text-sm">
                        {job.targetDocumentIds.map(id => documents.find(d => d.id === id)?.name || id).join(', ') || 'Нет'}
                      </span>
                    </div>
                    {job.status === 'completed' && job.result && job.result.length > 0 && (
                      <div className="space-y-3">
                        {job.result.map((group: ContradictionResult, gi: number) => (
                          <div key={gi} className="rounded-lg border border-[var(--line)] p-3">
                            <div className="text-sm font-medium mb-2 text-amber-200">
                              {group.target_document_name || `Документ #${group.target_document_id}`}
                            </div>
                            {group.summary && (
                              <p className="text-xs text-[var(--muted)] mb-2 leading-relaxed">{group.summary}</p>
                            )}
                            {group.contradictions?.map((c: Contradiction, ci: number) => (
                              <div key={ci} className="mt-2 border-l-2 border-l-amber-400 pl-3 text-xs space-y-1">
                                <p className="text-[var(--text)] opacity-80">База: {c.base_text}</p>
                                <p className="text-[var(--text)] opacity-80">Цель: {c.target_text}</p>
                                <p className="text-[var(--muted)]">{(c.confidence * 100).toFixed(0)}% — {c.explanation}</p>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {job.status === 'completed' && (!job.result || job.result.length === 0) && (
                      <p className="text-sm text-[var(--muted)]">Противоречий не найдено.</p>
                    )}
                    {job.status === 'processing' && (
                      <div className="flex items-center text-sm text-[var(--muted)]">
                        <Loader2 size={14} className="mr-1 animate-spin" />
                        Обработка задачи...
                      </div>
                    )}
                    {job.status === 'failed' && (
                      <div className="rounded-lg bg-red-500/10 border border-red-500/25 px-3 py-2 text-sm text-red-300">
                        Ошибка выполнения
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header
        className={`fixed inset-x-0 top-0 z-[110] transition-[transform,padding-right] duration-300 ${
          headerVisible ? 'translate-y-0' : '-translate-y-full'
        } ${isAnyPanelOpen ? 'lg:pr-[390px] lg:pointer-events-none' : ''}`}
      >
        <div className="mx-auto max-w-7xl px-3 pt-3 sm:px-6">
          <div className="rounded-2xl border border-[var(--line)] bg-[color:var(--surface)]/80 px-3 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl sm:px-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={openFilesPanelFromHeader}
                  className={`inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-2.5 py-2 text-[var(--muted)] transition hover:text-[var(--text)] ${
                    isAnyPanelOpen || isDesktopSidebarCollapsed ? 'lg:inline-flex' : 'lg:hidden'
                  }`}
                  aria-label="Open files"
                >
                  <PanelLeft size={16} />
                  <span className="hidden sm:inline">Файлы</span>
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-[var(--line)] px-1 text-xs">
                    {documents.length}
                  </span>
                </button>

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-[0.18em] text-[var(--text)]/90 uppercase">
                    {process.env.NEXT_PUBLIC_APP_BRAND_NAME || 'RUG Agent'}
                  </p>
                  <p className="truncate text-sm text-[var(--muted)]">Задавай вопросы по документам</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden rounded-xl border border-[var(--line)] px-3 py-2 text-sm text-[var(--muted)] sm:flex sm:items-center sm:gap-2">
                  {serverStatus === 'offline' ? <ServerOff size={14} /> : <Wifi size={14} />}
                  {serverStatus === 'checking'
                    ? 'Checking'
                    : serverStatus === 'online'
                      ? 'Server online'
                      : 'Server offline'}
                </div>
                <div className="inline-flex rounded-xl border border-[var(--line)] bg-[var(--bg)]/70 p-1">
                  <button
                    type="button"
                    aria-label="Light theme"
                    onClick={() => setThemeMode('light')}
                    className={`rounded-lg p-2 transition ${themeMode === 'light' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
                  >
                    <Sun size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Dark theme"
                    onClick={() => setThemeMode('dark')}
                    className={`rounded-lg p-2 transition ${themeMode === 'dark' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
                  >
                    <Moon size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section
        className={`mx-auto flex min-h-screen max-w-7xl gap-6 px-4 pb-8 pt-24 transition-[padding-right] duration-300 sm:px-6 sm:pt-28 ${
          isAnyPanelOpen ? 'lg:pr-[390px]' : ''
        }`}
      >
        <div
          className={`hidden overflow-hidden transition-[width,opacity] duration-300 ease-out lg:block ${
            showDesktopSidebar ? 'w-[320px] opacity-100' : 'w-0 opacity-0 pointer-events-none'
          }`}
        >
          <aside
            className={`fixed w-[320px] shrink-0 rounded-3xl border border-[var(--line)] bg-[var(--bg)] transition-[top,height] duration-300 ease-out ${
              headerVisible ? 'top-28 h-[calc(100vh-8rem)]' : 'top-4 h-[calc(100vh-2rem)]'
            }`}
          >
            {renderSidebarContent('desktop')}
          </aside>
        </div>

        <div className="relative mx-auto flex min-w-0 w-full max-w-4xl flex-1 flex-col">
          <div
            className={`ambient-logo-layer transition-opacity duration-700 ${
              hasFirstUserMessage ? 'opacity-0' : 'opacity-100'
            }`}
            aria-hidden
          >
            <div className="ambient-logo-wrap">
              <Image src="/chat-logo.svg" alt="" width={240} height={120} className="ambient-logo-img" sizes="(max-width: 640px) 190px, 240px" />
            </div>
          </div>
          {emptyState ? (
            shouldCenterComposer ? null : (
              <div className="relative flex flex-1 flex-col overflow-hidden py-10 text-center" />
            )
          ) : (
            <div className="relative flex-1 space-y-4 py-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    ref={(node) => {
                      if (message.role === 'user') {
                        messageBubbleRefs.current[message.id] = node;
                      }
                    }}
                    className={`max-w-[92%] transition-opacity duration-200 sm:max-w-[78%] ${
                      message.role === 'user'
                        ? `rounded-3xl border px-4 py-3 ${
                            message.isPendingAppearance
                              ? 'border-transparent bg-transparent opacity-0'
                              : 'border-[var(--accent)]/30 bg-[var(--accent)]/10'
                          }`
                        : 'border-none bg-transparent px-0 py-0'
                    }`}
                  >
                    {message.role === 'user' && message.scopeLabel ? (
                      <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--muted)]">
                        <FileText size={12} />
                        {message.scopeLabel}
                      </div>
                    ) : null}

                    {message.role === 'assistant' ? (
                      message.isStreaming ? (
                        <p className="whitespace-pre-wrap text-lg leading-8 sm:text-xl">
                          {renderConcentrationText(
                            message.text,
                            message.streamRevealChars ?? 0,
                            message.id
                          )}
                          {/* <span className="ml-1 inline-block animate-pulse text-[var(--muted)]">▌</span> */}
                        </p>
                      ) : (
                        <div className="space-y-2 text-lg leading-8 sm:text-xl">
                          {renderMarkdownText(message.text)}
                        </div>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap text-lg leading-8 sm:text-xl">{message.text}</p>
                    )}

                    {message.role === 'assistant' && !message.isStreaming ? (
                      <>
                        {message.warning ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400">
                              {message.warning}
                            </span>
                          </div>
                        ) : null}

                        {message.citations.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {message.citations.map((citation, index) => {
                              const citeKey = `${citation.document_id}-${index}`;
                              const isExpanded = expandedCitations.has(citeKey);
                              return (
                                <div
                                  key={citeKey}
                                  className={`rounded-2xl border transition duration-200 ${
                                    isDocumentPanelOpen &&
                                    documentPreview?.documentId === citation.document_id &&
                                    documentPreview?.highlightSnippet === citation.snippet
                                      ? 'citation-selected border-[var(--accent)]/45 bg-[var(--bg)]/72 shadow-[0_0_0_1px_rgba(63,134,255,0.18)]'
                                      : 'border-[var(--line)] bg-[var(--bg)]/65'
                                  } ${isDesktopDocumentPanelOpen ? 'relative z-[100] pointer-events-auto' : ''}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleCitation(citeKey)}
                                    className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/8 transition duration-200"
                                  >
                                    <p className="text-xs font-semibold tracking-[0.12em] text-[var(--accent)]">
                                      {citation.document_name}
                                    </p>
                                    <ChevronDown
                                      size={14}
                                      className={`shrink-0 text-[var(--muted)] transition-transform duration-200 ${
                                        isExpanded ? 'rotate-180' : ''
                                      }`}
                                    />
                                  </button>
                                  {isExpanded ? (
                                    <div className="border-t border-[var(--line)] px-3 pb-3 pt-2">
                                      <p className="text-sm leading-6 text-[var(--muted)]">{citation.snippet}</p>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void openDocumentPreview(
                                            citation.document_id,
                                            citation.document_name,
                                            citation.snippet
                                          )
                                        }
                                        className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--text)]"
                                      >
                                        <Eye size={12} />
                                        Открыть документ
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          <div
            className="relative z-[160] sticky bottom-4 mt-auto w-full"
          >
            <div className="rounded-[28px] border border-[var(--line)] bg-[color:var(--surface)]/92 p-3 shadow-[0_10px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl sm:p-4">
              {uiError ? (
                <div className="mb-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                  {uiError.message}
                </div>
              ) : null}

              <form onSubmit={onSubmit} className="flex items-end gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadDisabled}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--bg)]/70 text-[var(--muted)] transition hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Attach file"
                >
                  <Paperclip size={18} />
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files;
                    if (files && files.length > 0) {
                      void handleFiles(files);
                    }
                    event.currentTarget.value = '';
                  }}
                />

                <div
                  ref={composerFieldRef}
                  onClick={() => {
                    if (!noReadyDocs || !canOpenUploadFromHints) return;
                    fileInputRef.current?.click();
                  }}
                  className={`min-w-0 flex-1 rounded-2xl border border-[var(--line)] bg-[var(--bg)]/70 px-4 py-3 transition ${
                    noReadyDocs && canOpenUploadFromHints
                      ? 'cursor-pointer hover:border-[var(--accent)]/45 hover:bg-[var(--accent)]/8'
                      : ''
                  }`}
                >
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder={
                      !projectId
                        ? 'Сначала создайте проект в левой панели'
                        : noReadyDocs
                        ? 'Сначала прикрепите и дожддитесь индексации хотябы одного документа'
                        : selectedIndexedDocuments.length > 0
                          ? 'Задайте вопрос по выбранным файлам'
                          : 'Задайте вопрос по всем файлам'
                    }
                    disabled={isLiveOffline || uploadInProgress || noReadyDocs || isQueryBlocked}
                    className="w-full bg-transparent text-base font-semibold outline-none placeholder:font-medium placeholder:text-[var(--muted)] sm:text-lg"
                  />

                  <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-xs text-[var(--muted)]">
                    <div className="truncate">
                      {isUploadBlocked && uploadBlockedUntil
                        ? `Загрузка заблокирована до ${formatDateTime(uploadBlockedUntil)}`
                        : isQueryBlocked && queryBlockedUntil
                          ? `Запросы заблокированы до ${formatDateTime(queryBlockedUntil)}`
                          : !projectId
                            ? 'Сначала создайте проект в левой панели'
                          : activeUploadName && uploadState !== 'indexed'
                            ? `${activeUploadName} · ${formatStatus(uploadState)}`
                            : documents.length > 0
                              ? `Документов: ${documents.length}/${MAX_FILES_PER_PROJECT}, готово: ${indexedDocuments.length}`
                              : 'Сначала прикрепите и дожддитесь индексации хотябы одного документа'}
                    </div>
                    {uploadInProgress ? (
                      <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Loader2 size={13} className="animate-spin" />
                        {uploadState === 'uploading' ? 'Загрузка' : 'Индексация'}
                      </div>
                    ) : null}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={sendDisabled}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send"
                >
                  {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      <div className="pointer-events-none fixed inset-0 z-[220]">
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity lg:hidden ${
            isRightPanelOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setIsRightPanelOpen(false)}
        />
        <div
          className={`absolute inset-0 hidden lg:block ${
            isAnyPanelOpen ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          onClick={() => setIsRightPanelOpen(false)}
        />

        <div
          onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove}
          onTouchEnd={handleSidebarTouchEnd}
          className={`pointer-events-auto absolute left-0 top-0 z-[130] h-full w-[88vw] max-w-[360px] border-r border-[var(--line)] bg-[var(--bg)] shadow-[0_25px_80px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out lg:hidden ${
            isMobileFilesPanelOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {renderSidebarContent('mobile')}
        </div>

        <div
          onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove}
          onTouchEnd={handleSidebarTouchEnd}
          className={`pointer-events-auto absolute right-0 top-0 z-[130] h-full w-[88vw] max-w-[360px] border-l border-[var(--line)] bg-[var(--bg)] shadow-[0_25px_80px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out lg:w-[360px] ${
            isDocumentPanelOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {documentPreviewContent}
        </div>
      </div>

      <div
        onTouchStart={handleSidebarTouchStart}
        onTouchMove={handleSidebarTouchMove}
        onTouchEnd={handleSidebarTouchEnd}
        className={`pointer-events-auto fixed right-0 top-0 z-[300] h-full w-[88vw] max-w-[400px] border-l border-[var(--line)] bg-[var(--bg)] shadow-[0_25px_80px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out ${
          rightPanelView === 'contradiction' ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {renderContradictionAnalysisPanel()}
      </div>

      {flyingMessage ? (
        <div
          className="pointer-events-none fixed z-[95] rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/14 px-3 py-2 text-sm text-[var(--text)] shadow-[0_12px_36px_rgba(0,0,0,0.18)]"
          style={{
            left: flyingMessage.start.left,
            top: flyingMessage.start.top,
            width: flyingMessage.start.width,
            minHeight: flyingMessage.start.height,
            transformOrigin: 'top left',
            transform:
              flyingMessage.phase === 'end' || flyingMessage.phase === 'fade'
                ? `translate3d(${flyingMessage.end.left - flyingMessage.start.left}px, ${flyingMessage.end.top - flyingMessage.start.top}px, 0)`
                : 'translate3d(0px, 0px, 0)',
            opacity: flyingMessage.phase === 'fade' ? 0.01 : flyingMessage.phase === 'end' ? 0.72 : 0.98,
            transition:
              flyingMessage.phase === 'fade'
                ? `opacity ${FLYING_MESSAGE_FADE_MS}ms cubic-bezier(0.2, 0.9, 0.25, 1)`
                : `transform ${FLYING_MESSAGE_MOVE_MS}ms cubic-bezier(0.22, 0.65, 0.2, 1), opacity ${FLYING_MESSAGE_MOVE_MS}ms ease-out`
          }}
        >
          <span className="block whitespace-pre-wrap break-words">{flyingMessage.text}</span>
        </div>
      ) : null}

      {projectPendingDelete ? (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
            <p className="text-base font-semibold">Удалить проект и все файлы?</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Проект <span className="font-medium text-[var(--text)]">{projectPendingDelete.name}</span> будет удален без возможности восстановления.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setProjectPendingDelete(null)}
                disabled={deletingProjectId != null}
                className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void confirmProjectDelete()}
                disabled={deletingProjectId != null}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/15 px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingProjectId != null ? <Loader2 size={14} className="animate-spin" /> : null}
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isDragActive ? (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-[var(--bg)]/82 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-dashed border-[var(--accent)] bg-[var(--bg)]/90 p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
            <p className="text-lg font-semibold">Перетащите файлы сюда</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Поддерживаются PDF, DOC, DOCX, TXT, MD. До {MAX_FILES_PER_PROJECT} файлов в проекте и до {MAX_FILE_SIZE_MB} MB на файл.
            </p>
            {isUploadBlocked && uploadBlockedUntil ? (
              <p className="mt-3 text-sm text-rose-300">
                Загрузка временно заблокирована до {formatDateTime(uploadBlockedUntil)}.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
