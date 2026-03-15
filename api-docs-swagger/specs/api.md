# Mimir RAG System API Specification

Version: v1 <br>
Base Path: /api/v1 <br>
Content Type: application/json (except file uploads)

This API provides access to Mimir Retrieval-Augmented Generation (RAG) document system where:

- Projects are containers of documents.
- Documents exist only inside projects.
- Documents can be queried using RAG.
- Documents can be analyzed for contradictions.

---

# 1. Authentication

For now no authentication is required.

# 2. Resource Model

```
Project
 └── Project Context
 └── Documents
       └── Embeddings
       └── Document Content
       └── Extracted Text
 └── RAG Queries
 └── Analysis Jobs 
```

# 3. Projects

## Create Project

POST /api/v1/projects

Request:
```json
{
  "name": "Legal Contracts",
  "description": "Contracts for review"
}
```

Response:
```json
{
  "id": "proj_123",
  "name": "Legal Contracts",
  "description": "Contracts for review",
  "document_count": 0,
  "created_at": "2026-03-15T18:00:00Z"
}
```
---

## Get All Projects

GET /api/v1/projects?page=1&limit=20

Response:
```json
{
  "items": [
    {
      "id": "proj_123",
      "name": "Legal Contracts",
      "description": "Contracts for review",
      "document_count": 4,
      "created_at": "2026-03-15T18:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

## Get Project

GET /api/v1/projects/{project_id}

Response:
```json
{
  "id": "proj_123",
  "name": "Legal Contracts",
  "description": "Contracts for review",
  "document_count": 4,
  "created_at": "2026-03-15T18:00:00Z",
  "updated_at": "2026-03-15T18:10:00Z"
}
```

---

## Delete Project

DELETE /api/v1/projects/{project_id}

Response:

204 No Content

Deleting a project removes:

- all documents
- embeddings
- vector database entries

---

# 4. Documents

Documents represent files uploaded by users and exist only within a project.

## Upload Document

POST /api/v1/projects/{project_id}/documents
Content-Type: multipart/form-data

Form Fields:
- file (required)
- display_name (optional)

Response:
```json
{
  "id": "doc_456",
  "project_id": "proj_123",
  "name": "contract.pdf",
  "size_bytes": 1048576,
  "mime_type": "application/pdf",
  "status": "processing",
  "created_at": "2026-03-15T18:15:00Z"
}
```

Document Status:

uploaded → processing → indexed
                     ↘ failed

---

## List Documents

GET /api/v1/projects/{project_id}/documents?page=1&limit=20

Response:
```json
{
  "items": [
    {
      "id": "doc_456",
      "project_id": "proj_123",
      "name": "contract.pdf",
      "size_bytes": 1048576,
      "mime_type": "application/pdf",
      "status": "indexed",
      "created_at": "2026-03-15T18:15:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

## Get Document Metadata

GET /api/v1/projects/{project_id}/documents/{document_id}

Response:
```json
{
  "id": "doc_456",
  "project_id": "proj_123",
  "name": "contract.pdf",
  "size_bytes": 1048576,
  "mime_type": "application/pdf",
  "status": "indexed",
  "created_at": "2026-03-15T18:15:00Z",
  "updated_at": "2026-03-15T18:16:30Z"
}
```

---

## Delete Document

DELETE /api/v1/projects/{project_id}/documents/{document_id}

Response:

204 No Content

Deleting removes:
- stored file
- extracted text
- embeddings
- vector entries

---

# 5. Document Viewing

## Get Original File

GET /api/v1/projects/{project_id}/documents/{document_id}/content

Returns the raw document file.

Headers example:

Content-Type: application/pdf
Content-Disposition: inline; filename="contract.pdf"

---

## Get Extracted Text

GET /api/v1/projects/{project_id}/documents/{document_id}/text

Response:
```json
{
  "document_id": "doc_456",
  "text": "Full extracted text of the document..."
}
```

---

# 6. RAG Query

POST /api/v1/projects/{project_id}/rag/query

Request:
```json
{
  "question": "What are the termination conditions?",
  "target_document_ids": ["doc_456", "doc_457"]
}
```

Response:
```json
{
  "answer": "The agreement may be terminated with 30 days written notice.",
  "citations": [
    {
      "document_id": "doc_456",
      "document_name": "contract.pdf",
      "snippet": "Either party may terminate this agreement with 30 days written notice..."
    }
  ]
}
```

---

# 7. Contradiction Analysis

## Start Analysis

POST /api/v1/projects/{project_id}/analysis/contradictions

Request:
```json
{
  "base_document_id": "doc_456",
  "target_document_ids": ["doc_457", "doc_458"]
}
```

Response:
```json
{
  "job_id": "job_999",
  "status": "queued"
}
```

---

## Get Analysis Result

GET /api/v1/projects/{project_id}/analysis/contradictions/{job_id}

Response:
```json
{
  "job_id": "job_999",
  "status": "completed",
  "results": [
    {
      "target_document_id": "doc_457",
      "contradictions": [
        {
          "base_text": "Payment due in 60 days",
          "target_text": "Payment due in 30 days",
          "confidence": 0.84
        }
      ]
    }
  ]
}
```

---

# 8. Error Format
```json
{
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "Document does not exist in this project"
  }
}
```

---

# 9. Pagination

All list endpoints support:

?page=1&limit=20

Response:
```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

---

# 10. Design Principles

- Resources reflect the domain model
- Documents are scoped to projects
- Metadata and content retrieval are separate
- Heavy operations use async jobs
- Pagination supported everywhere
