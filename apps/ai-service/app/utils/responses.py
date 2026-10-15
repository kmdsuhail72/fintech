from datetime import datetime, timezone
from typing import TypeVar

from fastapi import Request
from pydantic import BaseModel

from app.schemas.analysis import AnalysisResponse

T = TypeVar("T", bound=BaseModel)


def response(data: T, request: Request) -> AnalysisResponse[T]:
    return AnalysisResponse(data=data, generated_at=datetime.now(timezone.utc),
                            request_id=request.state.request_id)
