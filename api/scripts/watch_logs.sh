#!/usr/bin/env bash

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_LOG="${SCRIPT_DIR}/../var/log/api.log"
WORKER_LOG="${SCRIPT_DIR}/../var/log/worker.log"

MODE="$(printf '%s' "${1:-both}" | tr '[:upper:]' '[:lower:]')"

COLOR_API=$'\033[1;36m'
COLOR_WORKER=$'\033[1;35m'
COLOR_RESET=$'\033[0m'

usage() {
  cat <<'EOF'
Usage:
  ./scripts/watch_logs.sh [api|worker|both]

Examples:
  ./scripts/watch_logs.sh
  ./scripts/watch_logs.sh api
  ./scripts/watch_logs.sh worker

Notes:
  - Best output quality requires `jq`.
  - Without `jq`, the script still tails logs in real time, but leaves JSON unformatted.
EOF
}

ensure_log_file() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  touch "$file"
}

format_json_line() {
  local line="$1"

  if command -v jq >/dev/null 2>&1; then
    jq -C . <<<"$line" 2>/dev/null || printf '%s\n' "$line"
    return
  fi

  printf '%s\n' "$line"
}

tail_stream() {
  local label="$1"
  local color="$2"
  local file="$3"

  ensure_log_file "$file"

  printf '%b[%s]%b watching %s\n' "$color" "$label" "$COLOR_RESET" "$file"

  trap '' PIPE
  while IFS= read -r line; do
    while IFS= read -r formatted_line; do
      printf '%b[%s]%b %s\n' "$color" "$label" "$COLOR_RESET" "$formatted_line"
    done < <(format_json_line "$line")
  done < <(tail -n 0 -F -- "$file" 2>/dev/null || true)
}

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}

trap cleanup EXIT INT TERM

case "$MODE" in
  api)
    tail_stream "api" "$COLOR_API" "$API_LOG"
    ;;
  worker)
    tail_stream "worker" "$COLOR_WORKER" "$WORKER_LOG"
    ;;
  both)
    tail_stream "api" "$COLOR_API" "$API_LOG" &
    tail_stream "worker" "$COLOR_WORKER" "$WORKER_LOG" &
    wait
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
