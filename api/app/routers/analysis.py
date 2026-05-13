from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_analysis_service
from app.schemas.analysis import (
    AnalysisJobAcceptedOut,
    AnalysisJobListOut,
    AnalysisJobOut,
    StartAnalysisIn,
)
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


@router.get("/contradictions", response_model=AnalysisJobListOut)
async def list_contradiction_jobs(
    project_id: int,
    status: str | None = Query(None),
    service: AnalysisService = Depends(get_analysis_service),
):
    jobs = await service.list_jobs(project_id, status)
    return {"items": jobs}


@router.delete("/contradictions/{job_id}", status_code=204)
async def delete_contradiction_job(
    project_id: int,
    job_id: int,
    service: AnalysisService = Depends(get_analysis_service),
):
    await service.delete_job(project_id, job_id)
