from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ProjectOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class ProjectListOut(BaseModel):
    items: list[ProjectOut]
    total: int
    page: int
    limit: int


class CreateProjectIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
