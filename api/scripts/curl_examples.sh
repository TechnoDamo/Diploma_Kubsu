#!/usr/bin/env bash

# Copy-paste request examples.
# Run from the `api/` directory so `./scripts/test_docs/...` resolves correctly.
# This file prints ready-to-paste commands; it does not execute them.

cat <<'EOF'
# Health
curl -fsS "http://localhost:8080/healthz"

# List projects
curl -fsS "http://localhost:8080/api/v1/projects"

# Create project
curl -fsS -X POST "http://localhost:8080/api/v1/projects" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Contracts Review Project",
    "description": "Project for contract comparison and RAG testing"
  }'

# Get project with id 1
curl -fsS "http://localhost:8080/api/v1/projects/1"

# Delete project with id 1
curl -fsS -X DELETE "http://localhost:8080/api/v1/projects/1"

# List documents for project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/documents"

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
curl -fsS "http://localhost:8080/api/v1/projects/1/documents/1"

# Download original document content for document 1 in project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/documents/1/content"

# Get reconstructed document text for document 1 in project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/documents/1/text"

# Delete document 1 in project 1
curl -fsS -X DELETE "http://localhost:8080/api/v1/projects/1/documents/1"

# RAG query across all indexed documents in project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/rag/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "What is the payment deadline?"
  }'

# RAG query against explicit documents in project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/rag/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "What are the retention obligations?",
    "target_document_ids": [1, 2, 3]
  }'

# Start contradiction analysis across all other indexed documents in project 1, using document 1 as the base
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/analysis/contradictions" \
  -H 'Content-Type: application/json' \
  -d '{
    "base_document_id": 1
  }'

# Start contradiction analysis for base document 1 against explicit target document 2 in project 1
curl -fsS -X POST "http://localhost:8080/api/v1/projects/1/analysis/contradictions" \
  -H 'Content-Type: application/json' \
  -d '{
    "base_document_id": 1,
    "target_document_ids": [2]
  }'

# Poll contradiction analysis job 1 for project 1
curl -fsS "http://localhost:8080/api/v1/projects/1/analysis/contradictions/1"
EOF
