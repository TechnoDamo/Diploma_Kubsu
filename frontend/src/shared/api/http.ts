import { env } from "../config/env";
import type {
  ApiError,
  ErrorResponse,
  ValidationErrorResponse,
} from "../types/api";

function isValidationError(value: unknown): value is ValidationErrorResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ValidationErrorResponse>;
  return (
    Array.isArray(candidate.issues) &&
    typeof candidate.error?.code === "string" &&
    typeof candidate.error?.message === "string"
  );
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ErrorResponse>;
  return (
    typeof candidate.error?.code === "string" &&
    typeof candidate.error?.message === "string"
  );
}

function normalizeError(status: number, payload: unknown): ApiError {
  if (isValidationError(payload)) {
    return {
      kind: "validation",
      status,
      code: payload.error.code,
      message: payload.error.message,
      issues: payload.issues,
    };
  }

  if (isErrorResponse(payload)) {
    return {
      kind: "error",
      status,
      code: payload.error.code,
      message: payload.error.message,
    };
  }

  return {
    kind: "error",
    status,
    code: "UNKNOWN_ERROR",
    message: "Unexpected error payload from API",
  };
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
};

type ExpectedResponse = "json" | "blob" | "text";

async function readResponse<T>(
  response: Response,
  expected: ExpectedResponse,
): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  if (expected === "blob") {
    return (await response.blob()) as T;
  }
  if (expected === "text") {
    return (await response.text()) as T;
  }
  return (await response.json()) as T;
}

async function requestCore<T>(
  path: string,
  options: RequestOptions = {},
  expected: ExpectedResponse,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${env.apiBaseUrl}${path}`;
  const isFormData = options.body instanceof FormData;
  const headers = new Headers(options.headers ?? {});

  if (!isFormData && options.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body: isFormData
      ? (options.body as FormData)
      : options.body && typeof options.body === "object"
        ? JSON.stringify(options.body)
        : (options.body as BodyInit | null | undefined),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw normalizeError(response.status, payload);
  }

  return readResponse<T>(response, expected);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestCore<T>(path, options, "json");
}

export async function apiRequestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  return requestCore<Blob>(path, options, "blob");
}

export async function apiRequestText(path: string, options: RequestOptions = {}): Promise<string> {
  return requestCore<string>(path, options, "text");
}
