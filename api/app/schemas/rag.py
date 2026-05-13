from typing import Any, Optional

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


class RetrievalQueryIn(BaseModel):
    text: str = Field(..., min_length=1)
    target_document_ids: Optional[list[int]] = None
    dense_weight: Optional[float] = Field(None, ge=0)
    sparse_weight: Optional[float] = Field(None, ge=0)
    limit: Optional[int] = Field(None, ge=1, le=100)
    include_text: bool = True
    include_payload: bool = True


class RetrievalPoint(BaseModel):
    point_id: str
    score: Optional[float] = None
    distance: Optional[float] = None
    document_id: Optional[int] = None
    chunk_id: Optional[int] = None
    chunk_order: Optional[int] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    text_preview: Optional[str] = None
    text: Optional[str] = None
    payload: Optional[dict[str, Any]] = None


class RetrievalQueryOut(BaseModel):
    query_text: str
    collection_name: str
    retrieval_mode: str
    dense_weight: float
    sparse_weight: float
    sparse_vector_enabled: bool
    limit: int
    points: list[RetrievalPoint]
