from typing import Any, Optional

from pydantic import BaseModel, Field


class StartAnalysisIn(BaseModel):
    base_document_id: int = Field(..., gt=0)
    target_document_ids: Optional[list[int]] = None


class AnalysisJobAcceptedOut(BaseModel):
    job_id: int
    status: str
    poll_url: str
    warning_message: Optional[str] = None


class AnalysisJobOut(BaseModel):
    job_id: int
    status: str
    poll_url: Optional[str] = None
    warning_message: Optional[str] = None
    results: Optional[Any] = None
    error_message: Optional[str] = None
