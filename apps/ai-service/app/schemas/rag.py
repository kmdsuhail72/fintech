from datetime import date, datetime
from typing import Literal
from uuid import UUID
from urllib.parse import urlparse

from pydantic import Field, field_validator
from app.schemas.analysis import StrictModel
from app.schemas.assistant import EvidenceSource


class DocumentMetadata(StrictModel):
    title: str = Field(min_length=1, max_length=300)
    document_type: Literal["company_report", "financial_document", "earnings_report", "market_research", "investment_education"]
    publisher: str = Field(min_length=1, max_length=200)
    published_date: date | None = None
    source_url: str | None = Field(default=None, max_length=2000)
    symbols: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("title", "publisher")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Metadata must not be blank")
        return value.strip()

    @field_validator("source_url")
    @classmethod
    def safe_url(cls, value):
        if value is not None:
            parsed = urlparse(value)
            if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Provide an HTTP(S) citation URL without credentials")
        return value

    @field_validator("symbols")
    @classmethod
    def symbols_uppercase(cls, values):
        import re
        values = [value.strip().upper() for value in values]
        if any(not re.fullmatch(r"[A-Z0-9.^_-]{1,24}", value) for value in values) or len(set(values)) != len(values):
            raise ValueError("Provide unique ticker symbols")
        return values


class DocumentIngestion(StrictModel):
    metadata: DocumentMetadata
    format: Literal["text", "markdown", "pdf"] = "text"
    # UTF-8 text for text/markdown; base64-encoded bytes for PDF.
    content: str = Field(min_length=1, max_length=8_000_000)


class DocumentRecord(StrictModel):
    id: UUID
    metadata: DocumentMetadata
    chunk_count: int
    embedding_model: str
    pipeline_version: str
    created_at: datetime


class DocumentList(StrictModel):
    documents: list[DocumentRecord]


class IngestionResult(StrictModel):
    document: DocumentRecord
    deduplicated: bool


class RetrievalRequest(StrictModel):
    question: str = Field(min_length=3, max_length=2000)
    document_ids: list[UUID] = Field(default_factory=list, max_length=20)
    top_k: int = Field(default=6, ge=1, le=12)

    @field_validator("question")
    @classmethod
    def nonblank(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Provide a question")
        return value.strip()


class RetrievalResult(StrictModel):
    sources: list[EvidenceSource]
    embedding_model: str
    warnings: list[str]


class DeleteResult(StrictModel):
    deleted: Literal[True] = True
