#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PROJECT_NAME="Smoke Test Project $(date +%s)"

TEXT_FILE_BASE="$TMP_DIR/base.txt"
TEXT_FILE_TARGET="$TMP_DIR/target.txt"
printf '%s\n' \
  "Payment is due within 30 days." \
  "Termination requires 30 days written notice." > "$TEXT_FILE_BASE"
printf '%s\n' \
  "Payment is due within 60 days." \
  "Termination requires 30 days written notice." > "$TEXT_FILE_TARGET"

echo "Creating project..."
PROJECT_RESPONSE="$(curl -fsS -X POST "${API_BASE_URL}/projects" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"${PROJECT_NAME}\",\"description\":\"Container smoke test project\"}")"
PROJECT_ID="$(printf '%s' "$PROJECT_RESPONSE" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["id"]')"
echo "Project ID: $PROJECT_ID"

echo "Uploading base text document..."
BASE_DOCUMENT_RESPONSE="$(curl -fsS -X POST "${API_BASE_URL}/projects/${PROJECT_ID}/documents" \
  -F "file=@${TEXT_FILE_BASE};type=text/plain" \
  -F "display_name=base.txt")"
BASE_DOCUMENT_ID="$(printf '%s' "$BASE_DOCUMENT_RESPONSE" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["id"]')"
echo "Base document ID: $BASE_DOCUMENT_ID"

echo "Uploading target text document..."
TARGET_DOCUMENT_RESPONSE="$(curl -fsS -X POST "${API_BASE_URL}/projects/${PROJECT_ID}/documents" \
  -F "file=@${TEXT_FILE_TARGET};type=text/plain" \
  -F "display_name=target.txt")"
TARGET_DOCUMENT_ID="$(printf '%s' "$TARGET_DOCUMENT_RESPONSE" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["id"]')"
echo "Target document ID: $TARGET_DOCUMENT_ID"

echo "Waiting for worker to index both documents..."
for _ in $(seq 1 20); do
  BASE_STATUS="$(curl -fsS "${API_BASE_URL}/projects/${PROJECT_ID}/documents/${BASE_DOCUMENT_ID}" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["status"]')"
  TARGET_STATUS="$(curl -fsS "${API_BASE_URL}/projects/${PROJECT_ID}/documents/${TARGET_DOCUMENT_ID}" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["status"]')"
  if [[ "$BASE_STATUS" == "indexed" && "$TARGET_STATUS" == "indexed" ]]; then
    break
  fi
  sleep 2
done

echo "Querying RAG..."
curl -fsS -X POST "${API_BASE_URL}/projects/${PROJECT_ID}/rag/query" \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is the payment deadline?"}' | ruby -rjson -e 'puts JSON.pretty_generate(JSON.parse(STDIN.read))'

echo "Starting contradiction analysis..."
ANALYSIS_RESPONSE="$(curl -fsS -X POST "${API_BASE_URL}/projects/${PROJECT_ID}/analysis/contradictions" \
  -H 'Content-Type: application/json' \
  -d "{\"base_document_id\":${BASE_DOCUMENT_ID},\"target_document_ids\":[${TARGET_DOCUMENT_ID}]}")"
JOB_ID="$(printf '%s' "$ANALYSIS_RESPONSE" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["job_id"]')"
echo "Analysis job ID: $JOB_ID"

echo "Polling contradiction analysis..."
for _ in $(seq 1 20); do
  JOB_RESPONSE="$(curl -fsS "${API_BASE_URL}/projects/${PROJECT_ID}/analysis/contradictions/${JOB_ID}")"
  JOB_STATUS="$(printf '%s' "$JOB_RESPONSE" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["status"]')"
  if [[ "$JOB_STATUS" == "completed" ]]; then
    printf '%s\n' "$JOB_RESPONSE" | ruby -rjson -e 'puts JSON.pretty_generate(JSON.parse(STDIN.read))'
    exit 0
  fi
  if [[ "$JOB_STATUS" == "failed" ]]; then
    printf '%s\n' "$JOB_RESPONSE" | ruby -rjson -e 'puts JSON.pretty_generate(JSON.parse(STDIN.read))'
    echo "Contradiction analysis failed" >&2
    exit 1
  fi
  sleep 2
done

echo "Timed out waiting for contradiction analysis completion" >&2
exit 1
