import logging
from pathlib import Path
from typing import Optional

from qdrant_client import models as qdrant_models
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.infra.llm import LLMClient
from app.infra.qdrant import QdrantRepository
from app.infra.tei import TEIClient
from app.support.sparse import generate_sparse_vectors
from app.support.text import clip_snippet

logger = logging.getLogger(__name__)


class RAGService:
    def __init__(
        self,
        db: AsyncSession,
        tei: TEIClient,
        llm: LLMClient,
        qdrant: QdrantRepository,
        settings: Settings,
    ):
        self._db = db
        self._tei = tei
        self._llm = llm
        self._qdrant = qdrant
        self._settings = settings

    async def query(
        self,
        project_id: int,
        question: str,
        target_document_ids: Optional[list[int]] = None,
    ) -> dict:
        project_r = await self._db.execute(
            text("SELECT id, state FROM documents.projects WHERE id = :pid"),
            {"pid": project_id},
        )
        project = project_r.first()
        if not project:
            raise RuntimeError(f"Project {project_id} not found")
        if project.state == "reindexing":
            raise RuntimeError("Project is reindexing")

        cfg_r = await self._db.execute(
            text("""
                SELECT embedding_model_name, embedding_dimension,
                       rag_top_k, rag_context_top_n,
                       rag_dense_weight, rag_sparse_weight,
                       query_rewrite_enabled, version
                FROM documents.project_index_configs
                WHERE project_id = :pid AND is_active = true
                ORDER BY version DESC LIMIT 1
            """),
            {"pid": project_id},
        )
        cfg = cfg_r.first()
        if not cfg:
            raise RuntimeError("No active index config found")

        rewrite_enabled = (
            cfg.query_rewrite_enabled
            if cfg.query_rewrite_enabled is not None
            else self._settings.query_rewrite_default_enabled
        )
        retrieval_top_k = (
            cfg.rag_top_k
            if cfg.rag_top_k is not None
            else self._settings.rag_retrieval_top_k
        )
        context_top_n = (
            cfg.rag_context_top_n
            if cfg.rag_context_top_n is not None
            else self._settings.rag_context_top_n
        )

        dense_weight = (
            cfg.rag_dense_weight
            if cfg.rag_dense_weight is not None
            else self._settings.rag_dense_weight
        )
        sparse_weight = (
            cfg.rag_sparse_weight
            if cfg.rag_sparse_weight is not None
            else self._settings.rag_sparse_weight
        )

        effective_question = question
        if rewrite_enabled:
            effective_question = await self._rewrite_question(question)

        query_embedding = await self._tei.embed([effective_question], cfg.embedding_dimension, cfg.embedding_model_name)
        query_vec = query_embedding[0]

        qdrant_filter = qdrant_models.Filter(
            must=[
                qdrant_models.FieldCondition(
                    key="project_id",
                    match=qdrant_models.MatchValue(value=project_id),
                )
            ]
        )
        if target_document_ids:
            qdrant_filter.must.append(
                qdrant_models.FieldCondition(
                    key="document_id",
                    match=qdrant_models.MatchAny(any=target_document_ids),
                )
            )

        sparse_vec = None
        if self._settings.sparse_vector_enabled:
            sparse_vec = await self._generate_query_sparse(effective_question)

        collection_name = f"{self._settings.qdrant_collection_name}_{project_id}"

        if sparse_vec and sparse_vec.get("indices"):
            results = await self._qdrant.search_hybrid(
                collection_name=collection_name,
                query_vector=query_vec,
                sparse_vector=sparse_vec,
                dense_weight=dense_weight,
                sparse_weight=sparse_weight,
                limit=retrieval_top_k,
                filter_condition=qdrant_filter,
            )
        else:
            results = await self._qdrant.search_dense(
                collection_name=collection_name,
                query_vector=query_vec,
                limit=retrieval_top_k,
                filter_condition=qdrant_filter,
            )

        top_chunks = results[:retrieval_top_k]
        if not top_chunks:
            return {
                "answer": "Информация по запросу в базе знаний не найдена.",
                "warning_message": None,
                "citations": [],
            }

        context_parts = []
        citations = {}
        seen_texts = set()
        for r in top_chunks:
            text_content = r["payload"].get("text", "") if r["payload"] else ""
            normalized = text_content.strip()
            if normalized in seen_texts:
                continue
            seen_texts.add(normalized)
            doc_name = await self._resolve_doc_name(r["payload"].get("document_id"))
            doc_id = r["payload"].get("document_id", 0)
            snippet = clip_snippet(text_content, 1200)
            context_parts.append(f"[Источник: {doc_name} (id:{doc_id})]\n{snippet}")
            if doc_id not in citations:
                citations[doc_id] = {
                    "document_id": doc_id,
                    "document_name": doc_name,
                    "snippet": snippet,
                }
            if len(context_parts) >= context_top_n:
                break

        context = "\n\n---\n\n".join(context_parts)

        try:
            answer = await self._answer_with_llm(project_id, question, context)
        except Exception as e:
            logger.warning("LLM answer generation failed, using fallback", exc_info=e)
            answer = self._build_fallback_answer(citations)

        return {
            "answer": answer,
            "warning_message": None,
            "citations": list(citations.values()),
        }

    async def retrieve_points(
        self,
        project_id: int,
        query_text: str,
        target_document_ids: Optional[list[int]] = None,
        dense_weight: Optional[float] = None,
        sparse_weight: Optional[float] = None,
        limit: Optional[int] = None,
        include_text: bool = True,
        include_payload: bool = True,
    ) -> dict:
        project_r = await self._db.execute(
            text("SELECT id, state FROM documents.projects WHERE id = :pid"),
            {"pid": project_id},
        )
        project = project_r.first()
        if not project:
            raise RuntimeError(f"Project {project_id} not found")
        if project.state == "reindexing":
            raise RuntimeError("Project is reindexing")

        cfg_r = await self._db.execute(
            text("""
                SELECT embedding_model_name, embedding_dimension,
                       rag_top_k, rag_dense_weight, rag_sparse_weight,
                       version
                FROM documents.project_index_configs
                WHERE project_id = :pid AND is_active = true
                ORDER BY version DESC LIMIT 1
            """),
            {"pid": project_id},
        )
        cfg = cfg_r.first()
        if not cfg:
            raise RuntimeError("No active index config found")

        effective_dense_weight = (
            dense_weight
            if dense_weight is not None
            else cfg.rag_dense_weight
            if cfg.rag_dense_weight is not None
            else self._settings.rag_dense_weight
        )
        effective_sparse_weight = (
            sparse_weight
            if sparse_weight is not None
            else cfg.rag_sparse_weight
            if cfg.rag_sparse_weight is not None
            else self._settings.rag_sparse_weight
        )
        if effective_dense_weight <= 0 and effective_sparse_weight <= 0:
            raise RuntimeError("At least one of dense_weight or sparse_weight must be greater than zero")

        effective_limit = (
            limit
            if limit is not None
            else cfg.rag_top_k
            if cfg.rag_top_k is not None
            else self._settings.rag_retrieval_top_k
        )

        query_embedding = await self._tei.embed([query_text], cfg.embedding_dimension, cfg.embedding_model_name)
        query_vec = query_embedding[0]

        qdrant_filter = qdrant_models.Filter(
            must=[
                qdrant_models.FieldCondition(
                    key="project_id",
                    match=qdrant_models.MatchValue(value=project_id),
                )
            ]
        )
        if target_document_ids:
            qdrant_filter.must.append(
                qdrant_models.FieldCondition(
                    key="document_id",
                    match=qdrant_models.MatchAny(any=target_document_ids),
                )
            )

        sparse_vec = None
        if self._settings.sparse_vector_enabled and effective_sparse_weight > 0:
            sparse_vec = await self._generate_query_sparse(query_text)

        collection_name = f"{self._settings.qdrant_collection_name}_{project_id}"
        retrieval_mode = self._qdrant.resolve_retrieval_mode(
            effective_dense_weight,
            effective_sparse_weight,
            sparse_vec,
        )

        results = await self._qdrant.search_hybrid(
            collection_name=collection_name,
            query_vector=query_vec,
            sparse_vector=sparse_vec,
            dense_weight=effective_dense_weight,
            sparse_weight=effective_sparse_weight,
            limit=effective_limit,
            filter_condition=qdrant_filter,
        )

        points = []
        for result in results:
            payload = result.get("payload") or {}
            point = {
                "point_id": result.get("point_id", ""),
                "score": result.get("score"),
                "distance": result.get("distance"),
                "document_id": payload.get("document_id"),
                "chunk_id": payload.get("chunk_id"),
                "chunk_order": payload.get("chunk_order"),
                "char_start": payload.get("char_start"),
                "char_end": payload.get("char_end"),
                "text_preview": payload.get("text_preview") or clip_snippet(payload.get("text", ""), 300),
                "text": payload.get("text") if include_text else None,
                "payload": payload if include_payload else None,
            }
            points.append(point)

        return {
            "query_text": query_text,
            "collection_name": collection_name,
            "retrieval_mode": retrieval_mode,
            "dense_weight": effective_dense_weight,
            "sparse_weight": effective_sparse_weight,
            "sparse_vector_enabled": bool(sparse_vec and sparse_vec.get("indices")),
            "limit": effective_limit,
            "points": points,
        }

    async def _resolve_doc_name(self, document_id: Optional[int]) -> str:
        if not document_id:
            return "неизвестно"
        try:
            r = await self._db.execute(
                text("SELECT name FROM documents.documents WHERE id = :did"),
                {"did": document_id},
            )
            row = r.first()
            return row.name if row else str(document_id)
        except Exception:
            return str(document_id)

    async def _rewrite_question(self, question: str) -> str:
        prompt_path = Path(self._settings.prompts_dir) / "rag_request.txt"
        try:
            system = prompt_path.read_text(encoding="utf-8")
        except (OSError, TypeError):
            return question

        prompt = system.replace("{{user_query}}", question)
        try:
            return (await self._llm.complete("", prompt)).strip()
        except Exception:
            return question

    async def _answer_with_llm(self, project_id: int, question: str, context: str) -> str:
        prompt_path = Path(self._settings.prompts_dir) / "rag_response.txt"
        try:
            system = prompt_path.read_text(encoding="utf-8")
        except (OSError, TypeError):
            system = "Answer the question based on the provided context."

        system = system.replace("{{user_question}}", question).replace(
            "{{retrieved_chunks}}", context
        )

        project_context = await self._load_project_context(project_id)
        if project_context:
            system += (
                "\n\n[Проект, о котором задан вопрос, содержит следующие документы:\n"
                f"{project_context}\n"
                "Конец описания проекта.]"
            )

        return await self._llm.complete(system, "")

    async def _load_project_context(self, project_id: int) -> str:
        r = await self._db.execute(
            text("SELECT general_context FROM documents.projects WHERE id = :pid"),
            {"pid": project_id},
        )
        row = r.first()
        return row.general_context.strip() if row and row.general_context else ""

    async def _generate_query_sparse(self, text: str) -> Optional[dict]:
        if not self._settings.sparse_vector_enabled:
            return None
        vecs = generate_sparse_vectors([text])
        return vecs[0] if vecs else None

    def _build_fallback_answer(self, citations: dict) -> str:
        parts = ["На основе найденных документов:\n"]
        for c in citations.values():
            parts.append(f"**{c['document_name']}**: {c['snippet']}")
        return "\n\n".join(parts)
