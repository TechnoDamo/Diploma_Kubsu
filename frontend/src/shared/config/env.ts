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

export const env = {
  apiBaseUrl: readEnv("VITE_API_BASE_URL", "http://localhost:8080/api/v1"),
  enableMocks: readBooleanEnv("VITE_ENABLE_MOCKS", false),
};
