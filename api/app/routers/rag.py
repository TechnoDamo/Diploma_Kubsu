from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_rag_service
from app.schemas.rag import RagQueryIn, RagQueryOut
from app.services.rag import RAGService

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/rag",
    tags=["rag"],
)


@router.post("/query", response_model=RagQueryOut)
async def query_rag(
    project_id: int,
    body: RagQueryIn,
    service: RAGService = Depends(get_rag_service),
):
    try:
        return await service.query(
            project_id=project_id,
            question=body.question,
            target_document_ids=body.target_document_ids,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
