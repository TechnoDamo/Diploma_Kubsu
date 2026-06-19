from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_project_service
from app.schemas.projects import CreateProjectIn, ProjectListOut, ProjectOut
from app.services.projects import (
    ProjectAlreadyExistsError,
    ProjectBusyError,
    ProjectNotFoundError,
    ProjectService,
)

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


@router.get("", response_model=ProjectListOut)
async def list_projects(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    service: ProjectService = Depends(get_project_service),
):
    return await service.list_projects(page=page, limit=limit)


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    body: CreateProjectIn,
    service: ProjectService = Depends(get_project_service),
):
    try:
        return await service.create_project(name=body.name, description=body.description)
    except ProjectAlreadyExistsError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: int,
    service: ProjectService = Depends(get_project_service),
):
    project = await service.get_project(project_id)
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="PROJECT_NOT_FOUND")
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: int,
    service: ProjectService = Depends(get_project_service),
):
    try:
        await service.delete_project(project_id)
    except ProjectNotFoundError:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="PROJECT_NOT_FOUND")
    except ProjectBusyError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail=str(e))
