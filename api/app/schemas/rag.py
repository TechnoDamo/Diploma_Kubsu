from typing import Optional

from pydantic import BaseModel, Field


class RagQueryIn(BaseModel):
    question: str = Field(..., min_length=1)
    target_document_ids: Optional[list[int]] = None


class Citation(BaseModel):
    document_id: int
    document_name: str
    snippet: str


class RagQueryOut(BaseModel):
    answer: str
    warning_message: Optional[str] = None
    citations: list[Citation]
