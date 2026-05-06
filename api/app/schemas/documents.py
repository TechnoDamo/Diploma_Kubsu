from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DocumentOut(BaseModel):
    id: int
    project_id: int
    name: str
    size_bytes: int
    mime_type: str
    status: str
    summary: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class DocumentListOut(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    limit: int


class DocumentTextOut(BaseModel):
    document_id: int
    text: str
