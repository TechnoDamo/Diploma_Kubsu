function readEnv(name: string, fallback?: string): string {
  const value = import.meta.env[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required env variable: ${name}`);
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  return value === "true";
}

function readNumberEnv(name: string, fallback: number): number {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export const env = {
  apiBaseUrl: readEnv("VITE_API_BASE_URL", "/api/v1"),
  enableMocks: readBooleanEnv("VITE_ENABLE_MOCKS", false),
  uploadMaxSizeBytes: readNumberEnv("VITE_UPLOAD_MAX_SIZE_BYTES", 26_214_400),
};
