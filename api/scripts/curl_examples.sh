#!/usr/bin/env bash

# Copy-paste request examples.
# Run from the `api/` directory so `./scripts/test_docs/...` resolves correctly.
# This file prints ready-to-paste commands; it does not execute them.

cat <<'EOF'
# Health
curl -fsS "http://localhost:8080/healthz"

# List projects
curl -fsS "http://localhost:8080/api/v1/projects?limit=100" | python -m json.tool --no-ensure-ascii

# Create project
curl -fsS -X POST "http://localhost:8080/api/v1/projects" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Contracts Review Project",
    "description": "Project for contract comparison and RAG testing"
  }' | python -m json.tool --no-ensure-ascii

# Get project with id 1
curl -fsS "http://localhost:8080/api/v1/projects/1" | python -m json.tool --no-ensure-ascii

# Delete project with id 1
curl -fsS -X DELETE "http://localhost:8080/api/v1/projects/1"

# List documents for project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/documents?limit=100" | python -m json.tool --no-ensure-ascii

# Upload plain-text document to project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/documents" \
  -F "file=@./scripts/test_docs/procurement_and_vendor_control.txt;type=text/plain" \
  -F "display_name=procurement_and_vendor_control.txt"

# Upload markdown document to project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/documents" \
  -F "file=@./scripts/test_docs/corporate_security_manual.md;type=text/markdown" \
  -F "display_name=corporate_security_manual.md"

# Upload second markdown document to project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/documents" \
  -F "file=@./scripts/test_docs/employee_handbook_extract.md;type=text/markdown" \
  -F "display_name=employee_handbook_extract.md"

# Upload PDF document to project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/documents" \
  -F "file=@./scripts/test_docs/business_continuity_program.pdf;type=application/pdf" \
  -F "display_name=business_continuity_program.pdf"

# Upload second PDF document to project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/documents" \
  -F "file=@./scripts/test_docs/records_retention_standard.pdf;type=application/pdf" \
  -F "display_name=records_retention_standard.pdf"

# Upload second plain-text document to project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/documents" \
  -F "file=@./scripts/test_docs/incident_response_playbook.txt;type=text/plain" \
  -F "display_name=incident_response_playbook.txt"

# Get document metadata for document 1 in project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/documents/1" | python -m json.tool --no-ensure-ascii

# Download original document content for document 1 in project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/documents/1/content"

# Get reconstructed document text for document 1 in project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/documents/1/text" | python -m json.tool --no-ensure-ascii

# Delete document 1 in project 1
curl -fsS -X DELETE "http://localhost:8080/api/v1/projects/1/documents/1"

# RAG query across all indexed documents in project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/rag/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "What is the payment deadline?"
  }' | python -m json.tool --no-ensure-ascii

# RAG query against explicit documents in project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/rag/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "What are the retention obligations?",
    "target_document_ids": [1, 2, 3]
  }' | python -m json.tool --no-ensure-ascii

# Start contradiction analysis across all other indexed documents in project 1, using document 1 as the base
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/analysis/contradictions" \
  -H 'Content-Type: application/json' \
  -d '{
    "base_document_id": 1
  }' | python -m json.tool --no-ensure-ascii

# Start contradiction analysis for base document 1 against explicit target document 2 in project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/analysis/contradictions" \
  -H 'Content-Type: application/json' \
  -d '{
    "base_document_id": 1,
    "target_document_ids": [2]
  }' | python -m json.tool --no-ensure-ascii

# Poll contradiction analysis job 1 for project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/analysis/contradictions/1" | python -m json.tool --no-ensure-ascii

###############################################################################
# Retrieval debug endpoint
#
# Vectorizes raw text, queries Qdrant, and returns structured points without LLM.
###############################################################################

# Hybrid retrieval through the API. Set sparse_weight=0 for dense-only or
# dense_weight=0 for sparse-only.
API_BASE="http://localhost:8080/api/v1"
PROJECT_ID=166
TARGET_DOCUMENT_ID=381

# Discover available projects first.
curl -fsS "${API_BASE}/projects?limit=100" | python -m json.tool --no-ensure-ascii

# Discover documents inside the selected project.
curl -fsS "${API_BASE}/projects/${PROJECT_ID}/documents?limit=100" | python -m json.tool --no-ensure-ascii

curl -fsS -X POST "${API_BASE}/projects/${PROJECT_ID}/retrieval/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "срок выплаты заработной платы",
    "target_document_ids": ['"${TARGET_DOCUMENT_ID}"'],
    "dense_weight": 0.7,
    "sparse_weight": 0.3,
    "limit": 5,
    "include_text": true,
    "include_payload": true
  }' | python -m json.tool --no-ensure-ascii

###############################################################################
# Direct Qdrant retrieval checks
#
# These examples are useful when debugging retrieval outside the API.
# Replace collection/project/document/point/vector values with real ones.
# The API reads RAG_DENSE_WEIGHT/RAG_SPARSE_WEIGHT and
# CONTRADICTION_DENSE_WEIGHT/CONTRADICTION_SPARSE_WEIGHT to decide which
# retrieval branches participate. With both branches enabled, Mimir uses
# Qdrant query_points prefetch + weighted RRF fusion.
###############################################################################

# Scroll points for a document. Existing collections may only have chunk_id order.
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/scroll" \
  -H 'Content-Type: application/json' \
  -d '{
    "filter": {
      "must": [
        {"key": "project_id", "match": {"value": 166}},
        {"key": "document_id", "match": {"value": 379}}
      ]
    },
    "order_by": {"key": "chunk_id", "direction": "asc"},
    "limit": 5,
    "with_payload": true,
    "with_vector": true
  }' | python -m json.tool --no-ensure-ascii

# Dense recommend search from an existing point id into a target document.
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"recommend": {"positive": ["POINT_ID"]}},
    "using": "dense",
    "filter": {"must": [{"key": "document_id", "match": {"value": 381}}]},
    "limit": 5,
    "with_payload": true
  }' | python -m json.tool --no-ensure-ascii

# Sparse search. Use real indices/values from a generated BM25 sparse vector.
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"indices": [100, 200], "values": [1.0, 0.7]},
    "using": "sparse",
    "filter": {"must": [{"key": "document_id", "match": {"value": 381}}]},
    "limit": 5,
    "with_payload": true
  }' | python -m json.tool --no-ensure-ascii

# Raw Qdrant hybrid fusion. This mirrors Mimir's hybrid backend path when both
# dense and sparse branches are enabled. Requires Qdrant 1.17.0+.
curl -fsS -X POST "http://localhost:6333/collections/mimir_project_166/points/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "prefetch": [
      {
        "query": {"recommend": {"positive": ["POINT_ID"]}},
        "using": "dense",
        "limit": 20
      },
      {
        "query": {"indices": [100, 200], "values": [1.0, 0.7]},
        "using": "sparse",
        "limit": 20
      }
    ],
    "query": {"rrf": {"weights": [0.7, 0.3]}},
    "filter": {"must": [{"key": "document_id", "match": {"value": 381}}]},
    "limit": 5,
    "with_payload": true
  }' | python -m json.tool --no-ensure-ascii
EOF
