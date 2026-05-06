from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_document_service
from app.schemas.documents import DocumentListOut, DocumentOut, DocumentTextOut
from app.services.documents import (
    DocumentBusyError,
    DocumentNotFoundError,
    DocumentNotReadyError,
    DocumentService,
    FileTooLargeError,
    ProjectNotFoundError,
    ProjectReindexingError,
    UnsupportedMediaError,
)

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/documents",
    tags=["documents"],
)


@router.get("", response_model=DocumentListOut)
async def list_documents(
    project_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    service: DocumentService = Depends(get_document_service),
):
    try:
        return await service.list_documents(project_id, page=page, limit=limit)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail="PROJECT_NOT_FOUND")


@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document(
    project_id: int,
    file: UploadFile = File(...),
    display_name: Optional[str] = Form(None),
    service: DocumentService = Depends(get_document_service),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="MISSING_UPLOAD_FILE")

    ext_to_mime = {
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".html": "text/html",
        ".htm": "text/html",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    import os
    ext = os.path.splitext(file.filename)[1].lower()
    mime_type = ext_to_mime.get(ext, file.content_type or "application/octet-stream")

    content = await file.read()

    try:
        return await service.create_document(
            project_id=project_id,
            filename=file.filename,
            mime_type=mime_type,
            content=content,
            display_name=display_name,
        )
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail="PROJECT_NOT_FOUND")
    except ProjectReindexingError:
        raise HTTPException(status_code=409, detail="PROJECT_REINDEXING")
    except UnsupportedMediaError as e:
        raise HTTPException(status_code=415, detail=str(e))
    except FileTooLargeError:
        raise HTTPException(status_code=413, detail="FILE_TOO_LARGE")


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    project_id: int,
    document_id: int,
    service: DocumentService = Depends(get_document_service),
):
    doc = await service.get_document(project_id, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="DOCUMENT_NOT_FOUND")
    return doc


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    project_id: int,
    document_id: int,
    service: DocumentService = Depends(get_document_service),
):
    try:
        await service.delete_document(project_id, document_id)
    except DocumentNotFoundError:
        raise HTTPException(status_code=404, detail="DOCUMENT_NOT_FOUND")
    except DocumentBusyError:
        raise HTTPException(status_code=409, detail="DOCUMENT_BUSY")
    except ProjectReindexingError:
        raise HTTPException(status_code=409, detail="PROJECT_REINDEXING")


@router.get("/{document_id}/text", response_model=DocumentTextOut)
async def get_document_text(
    project_id: int,
    document_id: int,
    service: DocumentService = Depends(get_document_service),
):
    try:
        return await service.get_document_text(project_id, document_id)
    except DocumentNotFoundError:
        raise HTTPException(status_code=404, detail="DOCUMENT_NOT_FOUND")
    except DocumentNotReadyError:
        raise HTTPException(status_code=409, detail="DOCUMENT_NOT_READY")


@router.get("/{document_id}/content")
async def get_document_content(
    project_id: int,
    document_id: int,
    service: DocumentService = Depends(get_document_service),
):
    try:
        result = await service.get_document_content(project_id, document_id)
    except DocumentNotFoundError:
        raise HTTPException(status_code=404, detail="DOCUMENT_NOT_FOUND")

    from fastapi.responses import Response
    return Response(
        content=result["data"],
        media_type=result["mime_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{result["name"]}"'
        },
    )
