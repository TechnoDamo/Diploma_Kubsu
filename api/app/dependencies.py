from functools import lru_cache
from typing import AsyncIterator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import create_engine, create_session_factory
from app.infra.docling import DoclingClient
from app.infra.files import FileStorage
from app.infra.llm import LLMClient
from app.infra.qdrant import QdrantRepository
from app.infra.tei import TEIClient
from app.services.analysis import AnalysisService
from app.services.documents import DocumentService
from app.services.indexing import IndexingService
from app.services.projects import ProjectService
from app.services.rag import RAGService

_engine = None
_session_factory = None


@lru_cache
def get_settings() -> Settings:
    return Settings()


async def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(get_settings())
    return _engine


async def get_session() -> AsyncIterator[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        engine = await get_engine()
        _session_factory = create_session_factory(engine)

    async with _session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_db() -> AsyncIterator[AsyncSession]:
    async for session in get_session():
        yield session


async def get_file_storage() -> FileStorage:
    return FileStorage(get_settings().files_root_dir)


async def get_docling_client() -> DoclingClient:
    return DoclingClient(get_settings().docling_base_url)


async def get_tei_client() -> TEIClient:
    s = get_settings()
    return TEIClient(
        s.tei_base_url, s.tei_http_timeout, s.embedding_api_key, s.embedding_model,
        s.embedding_api_type, s.embedding_max_retries, s.embedding_retry_delay,
    )


async def get_llm_client() -> LLMClient:
    s = get_settings()
    return LLMClient(s.llm_base_url, s.llm_api_key, s.llm_model, s.llm_http_timeout, s.llm_max_retries, s.llm_retry_delay)


async def get_qdrant_repo() -> QdrantRepository:
    s = get_settings()
    return QdrantRepository(s.qdrant_url, s.qdrant_api_key)


async def get_project_service(db: AsyncSession = Depends(get_db)) -> ProjectService:
    return ProjectService(db, get_settings(), await get_qdrant_repo())


async def get_document_service(db: AsyncSession = Depends(get_db)) -> DocumentService:
    return DocumentService(db, await get_file_storage(), get_settings())


async def get_indexing_service(db: AsyncSession = Depends(get_db)) -> IndexingService:
    return IndexingService(
        db,
        await get_file_storage(),
        await get_docling_client(),
        await get_tei_client(),
        await get_qdrant_repo(),
        await get_llm_client(),
        get_settings(),
    )


async def get_rag_service(db: AsyncSession = Depends(get_db)) -> RAGService:
    return RAGService(db, await get_tei_client(), await get_llm_client(), await get_qdrant_repo(), get_settings())


async def get_analysis_service(db: AsyncSession = Depends(get_db)) -> AnalysisService:
    return AnalysisService(db, await get_llm_client(), await get_qdrant_repo(), get_settings())
