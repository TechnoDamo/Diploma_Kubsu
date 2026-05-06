from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_analysis_service, get_db
from app.schemas.analysis import AnalysisJobAcceptedOut, AnalysisJobOut, StartAnalysisIn
from app.services.analysis import AnalysisService

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/analysis",
    tags=["analysis"],
)


@router.post("/contradictions", response_model=AnalysisJobAcceptedOut, status_code=202)
async def start_contradiction_analysis(
    project_id: int,
    body: StartAnalysisIn,
    service: AnalysisService = Depends(get_analysis_service),
):
    try:
        return await service.start_analysis(
            project_id=project_id,
            base_document_id=body.base_document_id,
            target_document_ids=body.target_document_ids,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/contradictions/{job_id}", response_model=AnalysisJobOut)
async def get_contradiction_analysis(
    project_id: int,
    job_id: int,
    service: AnalysisService = Depends(get_analysis_service),
):
    job = await service.get_job(project_id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="ANALYSIS_JOB_NOT_FOUND")
    return job
