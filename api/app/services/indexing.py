import asyncio
import time
import uuid
from typing import Optional

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.infra.docling import DoclingClient
from app.infra.files import FileStorage
from app.infra.llm import LLMClient
from app.infra.qdrant import QdrantRepository
from app.infra.tei import TEIClient
from app.support.sparse import generate_sparse_vectors
from app.support.text import chunk_text

logger = structlog.get_logger(__name__)


def _now_ms() -> float:
    return time.perf_counter() * 1000


class IndexingService:
    def __init__(
        self,
        db: AsyncSession,
        storage: FileStorage,
        docling: DoclingClient,
        tei: TEIClient,
        qdrant: QdrantRepository,
        llm: "LLMClient",
        settings: Settings,
    ):
        self._db = db
        self._storage = storage
        self._docling = docling
        self._tei = tei
        self._qdrant = qdrant
        self._llm = llm
        self._settings = settings

    async def process_next_job(self) -> Optional[int]:
        result = await self._db.execute(
            text("""
                WITH next_job AS (
                    SELECT id FROM documents.document_processing_jobs
                    WHERE status = 'queued'
                    ORDER BY created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE documents.document_processing_jobs AS j
                SET status = 'processing',
                    updated_at = CURRENT_TIMESTAMP,
                    attempt_count = attempt_count + 1,
                    last_error = NULL
                FROM next_job
                WHERE j.id = next_job.id
                RETURNING j.id, j.project_id, j.document_id, j.target_index_config_id
            """)
        )
        row = result.first()
        if not row:
            return None

        job_id = row.id
        document_id = row.document_id

        await self._db.execute(
            text("UPDATE documents.documents SET status = 'processing' WHERE id = :did"),
            {"did": document_id},
        )
        await self._db.commit()

        try:
            await self._process_document(document_id)
        except Exception as e:
            logger.error("document_indexing_failed",
                         document_id=document_id, job_id=job_id, error=str(e), exc_info=e)
            try:
                await self._db.rollback()
                await self._db.execute(
                    text("""
                        UPDATE documents.document_processing_jobs
                        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, last_error = :err
                        WHERE id = :jid
                    """),
                    {"jid": job_id, "err": str(e)[:1000]},
                )
                await self._db.execute(
                    text("UPDATE documents.documents SET status = 'failed', failure_reason = :err WHERE id = :did"),
                    {"did": document_id, "err": str(e)[:1000]},
                )
                await self._db.commit()
            except Exception:
                pass
            return job_id

        await self._db.execute(
            text("""
                UPDATE documents.document_processing_jobs
                SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                WHERE id = :jid
            """),
            {"jid": job_id},
        )
        await self._db.execute(
            text("""
                INSERT INTO documents.document_history (document_id, operation)
                VALUES (:did, 'index')
            """),
            {"did": document_id},
        )
        await self._db.commit()

        logger.info("document_indexed", document_id=document_id, job_id=job_id)
        return job_id

    async def _process_document(self, document_id: int) -> None:
        t0 = _now_ms()

        doc_r = await self._db.execute(
            text("""
                SELECT d.id, d.storage_key, d.mime_type, d.name, d.project_id,
                       c.embedding_model_name, c.embedding_dimension,
                       c.chunk_size, c.chunk_overlap, c.parser_name
                FROM documents.documents d
                JOIN documents.project_index_configs c ON c.id = d.indexed_config_id
                WHERE d.id = :did
            """),
            {"did": document_id},
        )
        doc = doc_r.first()
        if not doc:
            raise RuntimeError(f"Document {document_id} not found")

        project_id = doc.project_id
        collection_name = f"{self._settings.qdrant_collection_name}_{project_id}"

        logger.info("indexing_started",
                    document_id=document_id, doc_name=doc.name,
                    mime_type=doc.mime_type,
                    project_id=project_id, parser=self._settings.use_docling and "docling" or "python")

        # Extract text
        t_extract = _now_ms()
        data = await self._storage.read_all(doc.storage_key)
        from app.services.documents import DocumentService
        text_content = await DocumentService(None, None, self._settings).extract_text(data, doc.mime_type, doc.name)
        extract_ms = _now_ms() - t_extract
        logger.info("text_extracted",
                    document_id=document_id, text_length=len(text_content),
                    extract_ms=round(extract_ms))

        # Chunk
        t_chunk = _now_ms()
        chunks = chunk_text(text_content, doc.chunk_size, doc.chunk_overlap)
        chunk_ms = _now_ms() - t_chunk
        logger.info("text_chunked",
                    document_id=document_id, total_chunks=len(chunks),
                    chunk_size=doc.chunk_size, chunk_overlap=doc.chunk_overlap,
                    chunk_ms=round(chunk_ms))

        # Ensure Qdrant collection
        await self._qdrant.ensure_collection(
            collection_name=collection_name,
            vector_size=doc.embedding_dimension,
            sparse_enabled=self._settings.sparse_vector_enabled,
            on_disk_payload=self._settings.qdrant_on_disk_payload,
        )

        batch_size = self._settings.tei_embed_batch_size or 64
        max_concurrent = max(1, self._settings.max_embedding_concurrent_requests)
        sem = asyncio.Semaphore(max_concurrent)

        async def embed_batch(texts: list[str]) -> list[list[float]]:
            async with sem:
                return await self._tei.embed(texts, doc.embedding_dimension, doc.embedding_model_name)

        seen_texts: set[str] = set()
        unique_chunks = []
        for c in chunks:
            if c.text not in seen_texts:
                seen_texts.add(c.text)
                unique_chunks.append(c)

        if len(unique_chunks) < len(chunks):
            logger.info("chunks_deduplicated",
                        document_id=document_id,
                        total=len(chunks), unique=len(unique_chunks),
                        duplicates=len(chunks) - len(unique_chunks))

        chunk_ids = []
        texts = []

        cfg_r = await self._db.execute(
            text("SELECT indexed_config_id FROM documents.documents WHERE id = :did"),
            {"did": document_id},
        )
        config_id = cfg_r.scalar()

        total_batches = (len(unique_chunks) + batch_size - 1) // batch_size
        total_embed_ms = 0

        for batch_num, start in enumerate(range(0, len(unique_chunks), batch_size)):
            end = min(start + batch_size, len(unique_chunks))
            batch_chunks = unique_chunks[start:end]
            batch_texts = [c.text for c in batch_chunks]

            t_batch_start = _now_ms()
            batch_embeddings = await embed_batch(batch_texts)
            batch_ms = _now_ms() - t_batch_start
            total_embed_ms += batch_ms

            point_ids = [uuid.uuid4() for _ in batch_chunks]

            for i, chunk in enumerate(batch_chunks):
                r = await self._db.execute(
                    text("""
                        INSERT INTO documents.chunks (
                            document_id, project_id, index_config_id,
                            qdrant_point_id, chunk_order, text, char_start, char_end, token_count
                        ) VALUES (
                            :did, :pid, :cid, :qpid, :order, :text, :cs, :ce, :tc
                        )
                        RETURNING id
                    """),
                    {
                        "did": document_id,
                        "pid": project_id,
                        "cid": config_id,
                        "qpid": point_ids[i],
                        "order": chunk.order_id,
                        "text": chunk.text,
                        "cs": chunk.char_start,
                        "ce": chunk.char_end,
                        "tc": chunk.token_count,
                    },
                )
                chunk_id = r.scalar()
                chunk_ids.append(chunk_id)
                texts.append(chunk.text)

            sparse_vectors = None
            sparse_ms = 0
            if self._settings.sparse_vector_enabled:
                t_sparse = _now_ms()
                sparse_vectors = generate_sparse_vectors(batch_texts)
                sparse_ms = _now_ms() - t_sparse

            dense_vecs = []
            payloads = []
            for j, cid in enumerate(chunk_ids[-len(batch_chunks):]):
                dense_vecs.append(batch_embeddings[j])
                payloads.append({
                    "chunk_id": cid,
                    "chunk_order": batch_chunks[j].order_id,
                    "document_id": document_id,
                    "project_id": project_id,
                    "index_config_id": config_id,
                    "char_start": batch_chunks[j].char_start,
                    "char_end": batch_chunks[j].char_end,
                    "char_count": batch_chunks[j].char_count,
                    "text": batch_chunks[j].text,
                    "text_preview": batch_chunks[j].text[:2000],
                })

            t_upsert = _now_ms()
            await self._qdrant.upsert_chunks(
                collection_name=collection_name,
                chunk_ids=chunk_ids[-len(batch_chunks):],
                dense_vectors=dense_vecs,
                sparse_vectors=sparse_vectors,
                payloads=payloads,
                point_ids=point_ids,
            )
            upsert_ms = _now_ms() - t_upsert

            logger.info("embedding_batch",
                        document_id=document_id,
                        batch=f"{batch_num + 1}/{total_batches}",
                        chunks_in_batch=len(batch_chunks),
                        embed_ms=round(batch_ms),
                        sparse_ms=round(sparse_ms),
                        upsert_ms=round(upsert_ms),
                        total_embedded=end,
                        total_chunks=len(unique_chunks))

        # Summary (configurable)
        t_summary = _now_ms()
        if self._settings.generate_summary:
            summary = await self._generate_summary(text_content, doc.name)
        else:
            summary = ""
        summary_ms = _now_ms() - t_summary

        await self._db.execute(
            text("UPDATE documents.documents SET status = 'indexed', summary = :summary WHERE id = :did"),
            {"did": document_id, "summary": summary},
        )
        await self._db.execute(
            text("""
                UPDATE documents.projects
                SET general_context = general_context || '\n\n' || :summary
                WHERE id = :pid AND general_context NOT LIKE '%' || :doc_name || '%'
            """),
            {"pid": project_id, "summary": summary, "doc_name": doc.name},
        )
        await self._db.commit()

        total_ms = _now_ms() - t0
        logger.info("indexing_completed",
                    document_id=document_id, doc_name=doc.name,
                    total_chunks=len(chunks), total_batches=total_batches,
                    extract_ms=round(extract_ms), chunk_ms=round(chunk_ms),
                    embed_ms=round(total_embed_ms), summary_ms=round(summary_ms),
                    total_ms=round(total_ms))

    async def _generate_summary(self, text: str, doc_name: str) -> str:
        if not text.strip():
            return f"Документ: {doc_name}"

        seg_size = 10000
        segments = [text[i:i + seg_size] for i in range(0, len(text), seg_size)]

        if len(segments) == 1:
            return await self._summarize_segment(segments[0], doc_name) or f"Документ: {doc_name}"

        logger.info("Generating segment summaries", doc=doc_name, segments=len(segments))
        sem = asyncio.Semaphore(
            max(1, self._settings.max_contradiction_llm_concurrent_requests)
        )

        async def summarize_one(seg: str, idx: int) -> Optional[str]:
            async with sem:
                label = f"сегмент {idx + 1}/{len(segments)}"
                return await self._summarize_segment(seg, doc_name, label)

        tasks = [summarize_one(seg, i) for i, seg in enumerate(segments)]
        segment_summaries = await asyncio.gather(*tasks)
        valid = [s for s in segment_summaries if s]

        if not valid:
            return f"Документ: {doc_name}"

        logger.info("Generating final summary", doc=doc_name, segment_summaries=len(valid))
        combined = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(valid))
        prompt = (
            "Ты — ассистент. Ниже приведены краткие описания различных частей одного документа. "
            f"Составь итоговое описание документа \"{doc_name}\" (до 5 предложений), "
            "охватывающее его тему, тип, ключевые понятия и основные выводы. Отвечай на русском.\n\n"
            f"Описания частей:\n{combined}\n\nИтоговое описание:"
        )
        try:
            return (await self._llm.complete("", prompt)).strip()
        except Exception as e:
            logger.warning("Failed to generate final summary: %s", e)
            return valid[0] if valid else f"Документ: {doc_name}"

    async def _summarize_segment(self, text: str, doc_name: str, label: str = "") -> Optional[str]:
        sample = text[:10000]
        if not sample.strip():
            return None
        desc = f"документа \"{doc_name}\"" + (f" ({label})" if label else "")
        prompt = (
            f"Кратко опиши (2-3 предложения) содержание {desc} на основе приведённого фрагмента. "
            "Укажи тему и ключевые понятия. Отвечай на русском.\n\n"
            f"Фрагмент:\n{sample}\n\nКраткое описание:"
        )
        try:
            return (await self._llm.complete("", prompt)).strip()
        except Exception as e:
            logger.warning("Failed to summarize segment: %s", e)
            return None
