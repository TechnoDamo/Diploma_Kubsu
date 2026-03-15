import type { ApiError } from "../types/api";

export function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ApiError>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

export function readApiErrorMessage(value: unknown, fallback: string): string {
  if (isApiError(value)) {
    return `${value.code}: ${value.message}`;
  }
  return fallback;
}
