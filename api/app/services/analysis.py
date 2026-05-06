import asyncio
import json
import time
from pathlib import Path
from typing import Any, Optional

import structlog
from qdrant_client import models as qdrant_models
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.infra.llm import LLMClient
from app.infra.qdrant import QdrantRepository
from app.support.text import clip_snippet

logger = structlog.get_logger(__name__)


class AnalysisService:
    def __init__(
        self,
        db: AsyncSession,
        llm: LLMClient,
        qdrant: QdrantRepository,
        settings: Settings,
    ):
        self._db = db
        self._llm = llm
        self._qdrant = qdrant
        self._settings = settings

    async def start_analysis(
        self,
        project_id: int,
        base_document_id: int,
        target_document_ids: Optional[list[int]] = None,
    ) -> dict:
        doc_r = await self._db.execute(
            text("SELECT id, status FROM documents.documents WHERE id = :did AND project_id = :pid"),
            {"did": base_document_id, "pid": project_id},
        )
        doc = doc_r.first()
        if not doc:
            raise RuntimeError("Base document not found")
        if doc.status != "indexed":
            raise RuntimeError("Base document must be indexed")

        result = await self._db.execute(
            text("""
                INSERT INTO analysis.analysis_jobs (project_id, base_document_id, status)
                VALUES (:pid, :did, 'queued')
                RETURNING id
            """),
            {"pid": project_id, "did": base_document_id},
        )
        job_id = result.scalar()

        if target_document_ids:
            for tid in target_document_ids:
                await self._db.execute(
                    text("""
                        INSERT INTO analysis.analysis_job_targets (job_id, document_id)
                        VALUES (:jid, :did)
                        ON CONFLICT DO NOTHING
                    """),
                    {"jid": job_id, "did": tid},
                )

        await self._db.commit()

        return {
            "job_id": job_id,
            "status": "queued",
            "poll_url": f"/api/v1/projects/{project_id}/analysis/contradictions/{job_id}",
            "warning_message": None,
        }

    async def get_job(self, project_id: int, job_id: int) -> Optional[dict]:
        r = await self._db.execute(
            text("""
                SELECT id, project_id, base_document_id, status,
                       warning_message, error_message, results,
                       created_at, updated_at, completed_at
                FROM analysis.analysis_jobs
                WHERE id = :jid AND project_id = :pid
            """),
            {"jid": job_id, "pid": project_id},
        )
        row = r.first()
        if not row:
            return None

        return {
            "job_id": row.id,
            "status": row.status,
            "poll_url": f"/api/v1/projects/{project_id}/analysis/contradictions/{row.id}",
            "warning_message": row.warning_message,
            "results": row.results if row.status == "completed" else None,
            "error_message": row.error_message if row.status == "failed" else None,
        }

    async def process_next_job(self) -> Optional[int]:
        result = await self._db.execute(
            text("""
                WITH next_job AS (
                    SELECT id FROM analysis.analysis_jobs
                    WHERE status = 'queued'
                    ORDER BY created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE analysis.analysis_jobs AS j
                SET status = 'processing',
                    updated_at = CURRENT_TIMESTAMP,
                    attempt_count = attempt_count + 1,
                    claimed_at = CURRENT_TIMESTAMP
                FROM next_job
                WHERE j.id = next_job.id
                RETURNING j.id, j.project_id, j.base_document_id
            """)
        )
        row = result.first()
        if not row:
            return None

        job_id = row.id
        project_id = row.project_id
        base_doc_id = row.base_document_id

        await self._db.commit()

        try:
            await self._process_job(job_id, project_id, base_doc_id)
        except Exception as e:
            logger.error("analysis_job_failed", job_id=job_id, project_id=project_id, error=str(e), exc_info=e)
            await self._db.execute(
                text("""
                    UPDATE analysis.analysis_jobs
                    SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
                        error_message = :err, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :jid
                """),
                {"jid": job_id, "err": str(e)},
            )
            await self._db.commit()
            return job_id

        await self._db.commit()
        return job_id

    async def _process_job(self, job_id: int, project_id: int, base_doc_id: int) -> None:
        logger.info("analysis_job_started", job_id=job_id, project_id=project_id, base_doc_id=base_doc_id)
        t0 = time.perf_counter() * 1000
        cfg_r = await self._db.execute(
            text("""
                SELECT embedding_model_name, embedding_dimension, version,
                       contradiction_top_k, contradiction_max_distance,
                       contradiction_dense_weight, contradiction_sparse_weight
                FROM documents.project_index_configs
                WHERE project_id = :pid AND is_active = true
                ORDER BY version DESC LIMIT 1
            """),
            {"pid": project_id},
        )
        cfg = cfg_r.first()
        if not cfg:
            raise RuntimeError("No active index config found")

        top_k = (
            cfg.contradiction_top_k
            or self._settings.contradiction_top_k
        )
        max_dist = (
            cfg.contradiction_max_distance
            or self._settings.contradiction_max_distance
        )
        dense_weight = cfg.contradiction_dense_weight or self._settings.contradiction_dense_weight
        sparse_weight = cfg.contradiction_sparse_weight or self._settings.contradiction_sparse_weight

        target_ids = await self._resolve_targets(job_id, project_id, base_doc_id)

        max_retrieval = self._settings.max_contradiction_retrieval_concurrent_targets
        max_llm = self._settings.max_contradiction_llm_concurrent_requests
        max_pairs = self._settings.contradiction_max_pairs_per_job
        max_candidates = self._settings.contradiction_max_candidates_per_target

        all_candidates = []
        sem = asyncio.Semaphore(max_retrieval)
        collection_name = f"{self._settings.qdrant_collection_name}_{project_id}"

        async def collect_target(tid: int) -> list[dict]:
            async with sem:
                return await self._collect_candidates(
                    base_doc_id, tid, top_k, max_dist, max_candidates,
                    dense_weight, sparse_weight, collection_name,
                )

        tasks = [collect_target(tid) for tid in target_ids]
        results = await asyncio.gather(*tasks)

        for candidates in results:
            all_candidates.extend(candidates)

        all_candidates.sort(key=lambda c: c.get("distance", 1))
        seen = set()
        deduped = []
        for c in all_candidates:
            key = (c["target_document_id"], c.get("base_order", 0))
            if key not in seen:
                seen.add(key)
                deduped.append(c)

        final_candidates = deduped[:max_pairs]

        if not final_candidates:
            await self._db.execute(
                text("""
                    UPDATE analysis.analysis_jobs
                    SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                        results = '[]'::jsonb, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :jid
                """),
                {"jid": job_id},
            )
            return

        contradictions = []
        llm_sem = asyncio.Semaphore(max_llm)

        async def judge_candidate(candidate: dict) -> Optional[dict]:
            async with llm_sem:
                return await self._judge_pair(candidate)

        judge_tasks = [judge_candidate(c) for c in final_candidates]
        judge_results = await asyncio.gather(*judge_tasks)

        for candidate, judgement in zip(final_candidates, judge_results):
            if judgement and judgement.get("is_contradiction"):
                contradictions.append({
                    "target_document_id": candidate["target_document_id"],
                    "target_document_name": candidate.get("target_document_name", ""),
                    "base_chunk_order": candidate.get("base_order", 0),
                    "target_chunk_order": candidate.get("target_order", 0),
                    "base_text": candidate.get("base_text", "")[:300],
                    "target_text": candidate.get("target_text", "")[:300],
                    "confidence": judgement.get("confidence", 0),
                    "explanation": judgement.get("explanation", ""),
                })

        by_target: dict[int, dict[str, Any]] = {}
        for c in contradictions:
            tid = c["target_document_id"]
            if tid not in by_target:
                by_target[tid] = {
                    "target_document_id": tid,
                    "target_document_name": c["target_document_name"],
                    "contradictions": [],
                }
            by_target[tid]["contradictions"].append(c)

        results_summary = []
        for tid, group in by_target.items():
            findings = "\n".join(
                f"{i+1}. {c['explanation']}"
                for i, c in enumerate(group["contradictions"])
            )
            summary = await self._summarize_contradictions(group["target_document_name"], findings)
            results_summary.append({
                "target_document_id": tid,
                "target_document_name": group["target_document_name"],
                "summary": summary,
                "contradictions": group["contradictions"],
            })

        await self._db.execute(
            text("""
                UPDATE analysis.analysis_jobs
                SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                    results = :results::jsonb, updated_at = CURRENT_TIMESTAMP
                WHERE id = :jid
            """),
            {"jid": job_id, "results": json.dumps(results_summary, ensure_ascii=False)},
        )

        total_ms = time.perf_counter() * 1000 - t0
        logger.info("analysis_job_completed",
                    job_id=job_id, project_id=project_id,
                    candidates=len(final_candidates), contradictions=len(contradictions),
                    targets=len(target_ids), total_ms=round(total_ms))

    async def _resolve_targets(self, job_id: int, project_id: int, base_doc_id: int) -> list[int]:
        target_r = await self._db.execute(
            text("SELECT document_id FROM analysis.analysis_job_targets WHERE job_id = :jid"),
            {"jid": job_id},
        )
        explicit = [r.document_id for r in target_r]
        if explicit:
            return explicit

        indexed_r = await self._db.execute(
            text("""
                SELECT id FROM documents.documents
                WHERE project_id = :pid AND status = 'indexed' AND id != :bid
            """),
            {"pid": project_id, "bid": base_doc_id},
        )
        return [r.id for r in indexed_r]

    async def _collect_candidates(
        self,
        base_doc_id: int,
        target_doc_id: int,
        top_k: int,
        max_dist: float,
        max_candidates: int,
        dense_weight: float,
        sparse_weight: float,
        collection_name: str,
    ) -> list[dict]:
        target_name_r = await self._db.execute(
            text("SELECT name FROM documents.documents WHERE id = :did"),
            {"did": target_doc_id},
        )
        target_name = target_name_r.scalar() or ""

        base_chunks_r = await self._db.execute(
            text("""
                SELECT c.id, c.qdrant_point_id, c.chunk_order, c.text
                FROM documents.chunks c
                WHERE c.document_id = :did
                ORDER BY c.chunk_order
            """),
            {"did": base_doc_id},
        )
        base_chunks = [
            {"id": r.id, "point_id": str(r.qdrant_point_id), "order": r.chunk_order, "text": r.text}
            for r in base_chunks_r
        ]

        target_filter = qdrant_models.Filter(
            must=[
                qdrant_models.FieldCondition(
                    key="document_id",
                    match=qdrant_models.MatchValue(value=target_doc_id),
                )
            ]
        )

        candidates = []
        for bc in base_chunks:
            try:
                results = await self._qdrant._client.recommend(
                    collection_name=collection_name,
                    positive=[bc["point_id"]],
                    limit=top_k,
                    query_filter=target_filter,
                    score_threshold=max_dist,
                    with_payload=True,
                )
            except Exception:
                continue

            for r in results:
                payload = r.payload or {}
                candidates.append({
                    "target_document_id": target_doc_id,
                    "target_document_name": target_name,
                    "base_order": bc["order"],
                    "target_order": payload.get("chunk_order", 0),
                    "base_text": bc["text"],
                    "target_text": payload.get("text", ""),
                    "distance": 1.0 - r.score if r.score else 1.0,
                })

        candidates.sort(key=lambda c: c["distance"])
        return candidates[:max_candidates]

    async def _judge_pair(self, candidate: dict) -> Optional[dict]:
        prompt_path = Path(self._settings.prompts_dir) / "contradiction_discovery.txt"
        try:
            system = prompt_path.read_text(encoding="utf-8")
        except (OSError, TypeError):
            return None

        prompt = (
            system.replace("{{statement_a}}", candidate.get("base_text", ""))
            .replace("{{statement_b}}", candidate.get("target_text", ""))
        )

        try:
            response = await self._llm.complete("", prompt, json_mode=True)
            return json.loads(response)
        except Exception as e:
            logger.warning("LLM judgement failed for candidate", exc_info=e)
            return None

    async def _summarize_contradictions(self, target_name: str, findings: str) -> str:
        prompt_path = Path(self._settings.prompts_dir) / "contradiction_summary.txt"
        try:
            system = prompt_path.read_text(encoding="utf-8")
        except (OSError, TypeError):
            return f"Обнаружены противоречия с документом {target_name}."

        prompt = system.replace("{{contradiction_findings}}", findings)
        try:
            return await self._llm.complete("", prompt)
        except Exception:
            return f"Обнаружены противоречия с документом {target_name}."
