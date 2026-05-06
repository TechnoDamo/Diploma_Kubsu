import logging
from typing import Optional

from sqlalchemy import Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.infra.qdrant import QdrantRepository

logger = logging.getLogger(__name__)


class ProjectNotFoundError(Exception):
    pass


class ProjectAlreadyExistsError(Exception):
    pass


class ProjectBusyError(Exception):
    pass


class ProjectService:
    def __init__(self, db: AsyncSession, settings: Settings, qdrant: QdrantRepository):
        self._db = db
        self._settings = settings
        self._qdrant = qdrant

    async def list_projects(self, page: int = 1, limit: int = 10) -> dict:
        offset = (page - 1) * limit

        total_q = select(func.count()).select_from(text("documents.projects"))
        total_result = await self._db.execute(total_q)
        total = total_result.scalar() or 0

        rows_q = text("""
            SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                   COUNT(d.id)::BIGINT AS document_count
            FROM documents.projects AS p
            LEFT JOIN documents.documents AS d ON d.project_id = p.id
            GROUP BY p.id
            ORDER BY p.id DESC
            LIMIT :limit OFFSET :offset
        """)
        result = await self._db.execute(rows_q, {"limit": limit, "offset": offset})
        items = []
        for row in result:
            items.append({
                "id": row.id,
                "name": row.name,
                "description": row.description or None,
                "document_count": row.document_count,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            })

        return {"items": items, "total": total, "page": page, "limit": limit}

    async def create_project(self, name: str, description: Optional[str] = None) -> dict:
        context = description or ""

        try:
            result = await self._db.execute(
                text("""
                    INSERT INTO documents.projects (name, description, general_context)
                    VALUES (:name, :description, :context)
                    RETURNING id, name, description, created_at, updated_at
                """),
                {"name": name, "description": description or "", "context": context},
            )
            row = result.first()
        except Exception as e:
            pgcode = getattr(e, "pgcode", None)
            if pgcode == "23505" or (hasattr(e, "orig") and "unique" in str(e.orig).lower()):
                raise ProjectAlreadyExistsError(f"Project '{name}' already exists") from e
            raise

        project_id = row.id

        await self._db.execute(
            text("""
                INSERT INTO documents.project_index_configs (
                    project_id, version, is_active,
                    embedding_model_name, embedding_dimension,
                    parser_name, parser_version,
                    chunking_strategy, chunk_size, chunk_overlap, chunk_unit,
                    tokenizer_name,
                    rag_dense_weight, rag_sparse_weight,
                    contradiction_dense_weight, contradiction_sparse_weight
                ) VALUES (
                    :project_id, 1, true,
                    :embedding_model_name, :dimension,
                    :parser_name, :parser_version,
                    :chunking_strategy, :chunk_size, :chunk_overlap, :chunk_unit,
                    :tokenizer_name,
                    :rag_dense_weight, :rag_sparse_weight,
                    :contradiction_dense_weight, :contradiction_sparse_weight
                )
            """),
            {
                "project_id": project_id,
                "embedding_model_name": self._settings.project_index_defaults_embedding_model_name,
                "dimension": self._settings.project_index_defaults_embedding_dimension,
                "parser_name": self._settings.project_index_defaults_parser_name,
                "parser_version": self._settings.project_index_defaults_parser_version or None,
                "chunking_strategy": self._settings.project_index_defaults_chunking_strategy,
                "chunk_size": self._settings.project_index_defaults_chunk_size,
                "chunk_overlap": self._settings.project_index_defaults_chunk_overlap,
                "chunk_unit": self._settings.project_index_defaults_chunk_unit,
                "tokenizer_name": self._settings.project_index_defaults_tokenizer_name or None,
                "rag_dense_weight": self._settings.rag_dense_weight,
                "rag_sparse_weight": self._settings.rag_sparse_weight,
                "contradiction_dense_weight": self._settings.contradiction_dense_weight,
                "contradiction_sparse_weight": self._settings.contradiction_sparse_weight,
            },
        )

        await self._db.commit()

        return {
            "id": project_id,
            "name": row.name,
            "description": row.description or None,
            "document_count": 0,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    async def get_project(self, project_id: int) -> Optional[dict]:
        result = await self._db.execute(
            text("""
                SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                       COUNT(d.id)::BIGINT AS document_count
                FROM documents.projects AS p
                LEFT JOIN documents.documents AS d ON d.project_id = p.id
                WHERE p.id = :project_id
                GROUP BY p.id
            """),
            {"project_id": project_id},
        )
        row = result.first()
        if not row:
            return None
        return {
            "id": row.id,
            "name": row.name,
            "description": row.description or None,
            "document_count": row.document_count,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    async def delete_project(self, project_id: int) -> None:
        for q, msg in [
            (
                text("SELECT COUNT(*)::BIGINT FROM documents.document_processing_jobs "
                     "WHERE project_id = :pid AND status IN ('queued', 'processing')"),
                None,
            ),
            (
                text("SELECT COUNT(*)::BIGINT FROM analysis.analysis_jobs "
                     "WHERE project_id = :pid AND status IN ('queued', 'processing')"),
                None,
            ),
        ]:
            result = await self._db.execute(q, {"pid": project_id})
            count = result.scalar() or 0
            if count > 0:
                raise ProjectBusyError("Project has active jobs")

        result = await self._db.execute(
            text("DELETE FROM documents.projects WHERE id = :pid"),
            {"pid": project_id},
        )
        if result.rowcount == 0:
            raise ProjectNotFoundError(f"Project {project_id} not found")

        await self._db.commit()

        collection_name = f"{self._settings.qdrant_collection_name}_{project_id}"
        try:
            await self._qdrant._client.delete_collection(collection_name)
            logger.info("Deleted Qdrant collection", extra={"collection": collection_name})
        except Exception:
            logger.debug("Qdrant collection not found for deletion", extra={"collection": collection_name})
