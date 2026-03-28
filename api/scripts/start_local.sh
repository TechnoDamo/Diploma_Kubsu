#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${API_DIR}/.env"
LOG_DIR="${API_DIR}/var/log"
CACHE_DIR="${API_DIR}/../.tools/go-build-cache"
TMP_DIR="${API_DIR}/../.tools/go-tmp"
GO_BIN="${GO_BIN:-$(command -v go || true)}"

if [[ -z "${GO_BIN}" ]]; then
  echo "go binary not found in PATH. Set GO_BIN or install Go." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.example to .env first." >&2
  exit 1
fi

mkdir -p "${LOG_DIR}" "${CACHE_DIR}" "${TMP_DIR}"

cd "${API_DIR}"

set -a
source "${ENV_FILE}"
set +a

export GOCACHE="${GOCACHE:-${CACHE_DIR}}"
export GOTMPDIR="${GOTMPDIR:-${TMP_DIR}}"

API_PID=""
WORKER_PID=""

cleanup() {
  local exit_code=$?

  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
  fi

  if [[ -n "${WORKER_PID}" ]] && kill -0 "${WORKER_PID}" 2>/dev/null; then
    kill "${WORKER_PID}" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

echo "Starting API..."
"${GO_BIN}" run ./cmd/api/main.go >>"${LOG_DIR}/api.log" 2>&1 &
API_PID=$!

echo "Starting worker..."
"${GO_BIN}" run ./cmd/worker/main.go >>"${LOG_DIR}/worker.log" 2>&1 &
WORKER_PID=$!

echo "API PID: ${API_PID}"
echo "Worker PID: ${WORKER_PID}"
echo "Logs:"
echo "  ${LOG_DIR}/api.log"
echo "  ${LOG_DIR}/worker.log"
echo "Press Ctrl+C to stop both processes."

wait "${API_PID}" "${WORKER_PID}"
