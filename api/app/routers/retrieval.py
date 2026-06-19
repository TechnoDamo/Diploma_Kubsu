from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_rag_service
from app.schemas.rag import RetrievalQueryIn, RetrievalQueryOut
from app.services.rag import RAGService

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/retrieval",
    tags=["retrieval"],
)


@router.post("/query", response_model=RetrievalQueryOut)
async def query_retrieval(
    project_id: int,
    body: RetrievalQueryIn,
    service: RAGService = Depends(get_rag_service),
):
    try:
        return await service.retrieve_points(
            project_id=project_id,
            query_text=body.text,
            target_document_ids=body.target_document_ids,
            dense_weight=body.dense_weight,
            sparse_weight=body.sparse_weight,
            limit=body.limit,
            include_text=body.include_text,
            include_payload=body.include_payload,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
