import io
from io import BytesIO
from typing import Optional

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.infra.files import FileStorage
from app.support.text import Chunk as ChunkData, reconstruct_text

logger = structlog.get_logger(__name__)

SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/html",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


class DocumentNotFoundError(Exception):
    pass


class ProjectNotFoundError(Exception):
    pass


class ProjectReindexingError(Exception):
    pass


class DocumentBusyError(Exception):
    pass


class DocumentNotReadyError(Exception):
    pass


class FileTooLargeError(Exception):
    pass


class UnsupportedMediaError(Exception):
    pass


class DocumentService:
    def __init__(self, db: AsyncSession, storage: FileStorage, settings: Settings):
        self._db = db
        self._storage = storage
        self._settings = settings

    async def _check_project_state(self, project_id: int) -> dict:
        result = await self._db.execute(
            text("SELECT state FROM documents.projects WHERE id = :pid"),
            {"pid": project_id},
        )
        row = result.first()
        if not row:
            return {"exists": False, "reindexing": False}
        return {"exists": True, "reindexing": row.state == "reindexing"}

    async def list_documents(self, project_id: int, page: int = 1, limit: int = 10) -> dict:
        state = await self._check_project_state(project_id)
        if not state["exists"]:
            raise ProjectNotFoundError(f"Project {project_id} not found")

        offset = (page - 1) * limit

        total_r = await self._db.execute(
            text("SELECT COUNT(*)::BIGINT FROM documents.documents WHERE project_id = :pid"),
            {"pid": project_id},
        )
        total = total_r.scalar() or 0

        rows = await self._db.execute(
            text("""
                SELECT d.id, d.project_id, d.name, d.size_bytes, d.mime_type,
                       d.status, d.created_at, d.updated_at
                FROM documents.documents AS d
                WHERE d.project_id = :pid
                ORDER BY d.id DESC
                LIMIT :limit OFFSET :offset
            """),
            {"pid": project_id, "limit": limit, "offset": offset},
        )
        items = [
            {
                "id": r.id,
                "project_id": r.project_id,
                "name": r.name,
                "size_bytes": r.size_bytes,
                "mime_type": r.mime_type,
                "status": r.status,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in rows
        ]

        return {"items": items, "total": total, "page": page, "limit": limit}

    async def create_document(
        self,
        project_id: int,
        filename: str,
        mime_type: str,
        content: bytes,
        display_name: Optional[str] = None,
    ) -> dict:
        if mime_type not in SUPPORTED_MIME_TYPES:
            raise UnsupportedMediaError(f"Unsupported media type: {mime_type}")

        if len(content) > self._settings.http_max_upload_size_bytes:
            raise FileTooLargeError(
                f"File exceeds max upload size of {self._settings.http_max_upload_size_bytes} bytes"
            )

        state = await self._check_project_state(project_id)
        if not state["exists"]:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        if state["reindexing"]:
            raise ProjectReindexingError("Project is reindexing")

        buf = BytesIO(content)
        saved = await self._storage.save(filename, buf)

        name = (display_name or filename).strip()
        logger.info("document_uploaded",
                     doc_name=name, mime_type=mime_type,
                     size_bytes=saved.size_bytes, project_id=project_id)

        config_r = await self._db.execute(
            text("""
                SELECT id, version, embedding_model_name, embedding_dimension,
                       parser_name, parser_version, chunking_strategy,
                       chunk_size, chunk_overlap, chunk_unit, tokenizer_name
                FROM documents.project_index_configs
                WHERE project_id = :pid AND is_active = true
                ORDER BY version DESC LIMIT 1
            """),
            {"pid": project_id},
        )
        cfg = config_r.first()
        if not cfg:
            raise RuntimeError("No active project index config found")

        doc_r = await self._db.execute(
            text("""
                INSERT INTO documents.documents (
                    project_id, name, storage_key, size_bytes, mime_type, sha256,
                    status, indexed_config_id
                ) VALUES (
                    :pid, :name, :storage_key, :size_bytes, :mime_type, :sha256,
                    'uploaded', :config_id
                )
                RETURNING id, project_id, name, size_bytes, mime_type, status, created_at, updated_at
            """),
            {
                "pid": project_id,
                "name": name,
                "storage_key": saved.relative_path,
                "size_bytes": saved.size_bytes,
                "mime_type": mime_type,
                "sha256": saved.checksum,
                "config_id": cfg.id,
            },
        )
        doc = doc_r.first()

        await self._db.execute(
            text("""
                INSERT INTO documents.document_processing_jobs (
                    project_id, document_id, kind, status, target_index_config_id
                ) VALUES (:pid, :did, 'ingest', 'queued', :config_id)
            """),
            {"pid": project_id, "did": doc.id, "config_id": cfg.id},
        )

        await self._db.execute(
            text("INSERT INTO documents.document_history (document_id, operation) VALUES (:did, 'upload')"),
            {"did": doc.id},
        )

        await self._db.commit()

        return {
            "id": doc.id,
            "project_id": doc.project_id,
            "name": doc.name,
            "size_bytes": doc.size_bytes,
            "mime_type": doc.mime_type,
            "status": doc.status,
            "created_at": doc.created_at,
            "updated_at": doc.updated_at,
        }

    async def get_document(self, project_id: int, document_id: int) -> Optional[dict]:
        r = await self._db.execute(
            text("""
                SELECT id, project_id, name, size_bytes, mime_type, status, summary,
                       created_at, updated_at, storage_key
                FROM documents.documents
                WHERE project_id = :pid AND id = :did
            """),
            {"pid": project_id, "did": document_id},
        )
        row = r.first()
        if not row:
            return None
        return {
            "id": row.id,
            "project_id": row.project_id,
            "name": row.name,
            "size_bytes": row.size_bytes,
            "mime_type": row.mime_type,
            "status": row.status,
            "summary": row.summary or None,
            "storage_key": row.storage_key,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    async def delete_document(self, project_id: int, document_id: int) -> None:
        state = await self._check_project_state(project_id)
        if not state["exists"]:
            raise DocumentNotFoundError(f"Document {document_id} not found")
        if state["reindexing"]:
            raise ProjectReindexingError("Project is reindexing")

        doc = await self.get_document(project_id, document_id)
        if not doc:
            raise DocumentNotFoundError(f"Document {document_id} not found")

        for q in [
            text("SELECT COUNT(*)::BIGINT FROM documents.document_processing_jobs "
                 "WHERE document_id = :did AND status IN ('queued', 'processing')"),
            text("""
                SELECT COUNT(DISTINCT j.id)::BIGINT
                FROM analysis.analysis_jobs AS j
                LEFT JOIN analysis.analysis_job_targets AS t ON t.job_id = j.id
                WHERE j.status IN ('queued', 'processing')
                  AND (j.base_document_id = :did OR t.document_id = :did)
            """),
        ]:
            r = await self._db.execute(q, {"did": document_id})
            if (r.scalar() or 0) > 0:
                raise DocumentBusyError("Document has active jobs")

        await self._db.execute(
            text("DELETE FROM analysis.analysis_job_targets AS t USING analysis.analysis_jobs AS j WHERE t.job_id = j.id AND t.document_id = :did AND j.status IN ('completed', 'failed')"),
            {"did": document_id},
        )
        await self._db.execute(
            text("DELETE FROM analysis.analysis_jobs WHERE base_document_id = :did AND status IN ('completed', 'failed')"),
            {"did": document_id},
        )

        await self._db.execute(
            text("INSERT INTO documents.document_history (document_id, operation) VALUES (:did, 'delete')"),
            {"did": document_id},
        )
        await self._db.execute(
            text("DELETE FROM documents.documents WHERE id = :did"),
            {"did": document_id},
        )
        await self._db.commit()

        await self._storage.delete(doc.get("storage_key", ""))

    async def get_document_text(self, project_id: int, document_id: int) -> Optional[dict]:
        doc = await self.get_document(project_id, document_id)
        if not doc:
            raise DocumentNotFoundError(f"Document {document_id} not found")
        if doc["status"] != "indexed":
            raise DocumentNotReadyError("Document is not indexed yet")

        rows = await self._db.execute(
            text("""
                SELECT text, char_start, char_end
                FROM documents.chunks
                WHERE document_id = :did
                ORDER BY chunk_order
            """),
            {"did": document_id},
        )
        chunks = []
        for r in rows:
            chunks.append(ChunkData(
                order_id=0,
                text=r.text,
                char_start=r.char_start,
                char_end=r.char_end,
                char_count=r.char_end - r.char_start,
                token_count=0,
            ))

        return {"document_id": document_id, "text": reconstruct_text(chunks)}

    async def get_document_content(self, project_id: int, document_id: int) -> Optional[dict]:
        doc = await self.get_document(project_id, document_id)
        if not doc:
            raise DocumentNotFoundError(f"Document {document_id} not found")

        data = await self._storage.read_all(doc["storage_key"])
        return {
            "document_id": doc["id"],
            "name": doc["name"],
            "mime_type": doc["mime_type"],
            "data": data,
        }

    async def load_document_for_processing(self, document_id: int) -> Optional[dict]:
        r = await self._db.execute(
            text("""
                SELECT id, storage_key, mime_type, name, size_bytes, sha256,
                       status, indexed_config_id
                FROM documents.documents WHERE id = :did
            """),
            {"did": document_id},
        )
        row = r.first()
        if not row:
            return None

        cfg_r = await self._db.execute(
            text("""
                SELECT embedding_model_name, embedding_dimension, chunk_size, chunk_overlap,
                       parser_name, chunking_strategy
                FROM documents.project_index_configs WHERE id = :cid
            """),
            {"cid": row.indexed_config_id},
        )
        cfg = cfg_r.first()
        if not cfg:
            return None

        return {
            "id": row.id,
            "storage_key": row.storage_key,
            "mime_type": row.mime_type,
            "name": row.name,
            "size_bytes": row.size_bytes,
            "sha256": row.sha256,
            "status": row.status,
            "indexed_config_id": row.indexed_config_id,
            "embedding_model_name": cfg.embedding_model_name,
            "embedding_dimension": cfg.embedding_dimension,
            "chunk_size": cfg.chunk_size,
            "chunk_overlap": cfg.chunk_overlap,
            "parser_name": cfg.parser_name,
            "chunking_strategy": cfg.chunking_strategy,
        }

    async def extract_pdf_text(self, content: bytes, use_docling: bool) -> str:
        if use_docling:
            from app.infra.docling import DoclingClient
            docling = DoclingClient(self._settings.docling_base_url, self._settings.docling_timeout_seconds)
            return await docling.convert_file("document.pdf", content, "application/pdf")
        else:
            import PyPDF2
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(content))
            text = ""
            for page_num in range(len(pdf_reader.pages)):
                page = pdf_reader.pages[page_num]
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n\n"
            return text

    async def extract_text(self, content: bytes, mime_type: str, filename: str) -> str:
        if mime_type in ("text/plain", "text/markdown"):
            return content.decode("utf-8", errors="replace")

        if mime_type == "application/pdf":
            return await self.extract_pdf_text(content, self._settings.use_docling)

        if self._settings.use_docling:
            from app.infra.docling import DoclingClient
            docling = DoclingClient(self._settings.docling_base_url, self._settings.docling_timeout_seconds)
            return await docling.convert_file(filename, content, mime_type)

        if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            import docx
            doc = docx.Document(io.BytesIO(content))
            return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())

        if mime_type == "text/html":
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(content, "html.parser")
            return soup.get_text(separator="\n", strip=True)

        raise RuntimeError(f"No local parser for {mime_type}. Use USE_DOCLING=true or convert to supported format.")
