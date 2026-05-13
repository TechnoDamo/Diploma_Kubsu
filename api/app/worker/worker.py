import asyncio
import signal

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import (
    get_docling_client,
    get_file_storage,
    get_llm_client,
    get_persistent_db,
    get_qdrant_repo,
    get_settings,
    get_tei_client,
)
from app.services.indexing import IndexingService
from app.services.analysis import AnalysisService
from app.support.logging import setup_logging

logger = structlog.get_logger(__name__)


class Worker:
    def __init__(
        self,
        db: AsyncSession,
        indexing_service: IndexingService,
        analysis_service: AnalysisService,
        poll_interval: int = 3,
    ):
        self._db = db
        self._indexing = indexing_service
        self._analysis = analysis_service
        self._poll_interval = poll_interval
        self._running = True

    async def run(self):
        logger.info("Worker started", poll_interval=self._poll_interval)
        while self._running:
            try:
                doc_job = await self._indexing.process_next_job()
                if doc_job:
                    logger.info("Document job processed", job_id=doc_job)
            except Exception as e:
                logger.error("Document processing pass failed", exc_info=e)
                await self._db.rollback()

            try:
                analysis_job = await self._analysis.process_next_job()
                if analysis_job:
                    logger.info("Analysis job processed", job_id=analysis_job)
            except Exception as e:
                logger.error("Analysis pass failed", exc_info=e)
                await self._db.rollback()

            await asyncio.sleep(self._poll_interval)

        logger.info("Worker shutting down gracefully")

    def shutdown(self):
        self._running = False


async def main():
    settings = get_settings()
    setup_logging(
        log_level=settings.log_level,
        log_format=settings.log_format,
        graylog_enabled=settings.graylog_enabled,
        graylog_host=settings.graylog_host,
        graylog_port=settings.graylog_port,
    )

    db = await get_persistent_db()

    storage = await get_file_storage()
    docling = await get_docling_client()
    tei = await get_tei_client()
    qdrant = await get_qdrant_repo()
    llm = await get_llm_client()

    indexing = IndexingService(db, storage, docling, tei, qdrant, llm, settings)
    analysis = AnalysisService(db, llm, qdrant, settings)

    worker = Worker(
        db=db,
        indexing_service=indexing,
        analysis_service=analysis,
        poll_interval=settings.worker_poll_interval,
    )

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, worker.shutdown)

    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
