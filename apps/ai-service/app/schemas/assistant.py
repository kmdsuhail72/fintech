from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.analysis import StrictModel

SECTION_TITLES = {
    "summary": "Summary", "market_context": "Market Context",
    "technical_analysis": "Technical Analysis", "news_sentiment": "News Sentiment",
    "potential_risks": "Potential Risks", "potential_opportunities": "Potential Opportunities",
    "educational_conclusion": "Educational Conclusion",
}


class AssistantRequest(StrictModel):
    question: str = Field(min_length=3, max_length=2000)
    symbols: list[str] = Field(default_factory=list, max_length=4)
    include_portfolio: bool | None = None
    interval: Literal["1m", "5m", "15m", "1h", "1d"] = "1d"
    include_documents: bool = False
    document_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("question")
    @classmethod
    def nonblank(cls, value: str):
        if len(value.strip()) < 3:
            raise ValueError("Provide a research question.")
        return value.strip()

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, values: list[str]):
        import re
        values = [value.strip().upper() for value in values]
        if len(values) != len(set(values)) or any(not re.fullmatch(r"[A-Z0-9.^_-]{1,24}", value) for value in values):
            raise ValueError("Provide up to four unique supported ticker symbols.")
        return values


class EvidenceSource(StrictModel):
    id: str
    kind: str
    title: str
    available: bool
    as_of: str | None
    url: str | None
    data: dict[str, Any]


class ResearchSection(StrictModel):
    content: str
    source_ids: list[str]


class ResearchDraft(StrictModel):
    summary: ResearchSection
    market_context: ResearchSection
    technical_analysis: ResearchSection
    news_sentiment: ResearchSection
    potential_risks: ResearchSection
    potential_opportunities: ResearchSection
    educational_conclusion: ResearchSection


class AssistantResearch(ResearchDraft):
    ai_generated: Literal[True] = True
    label: Literal["AI-generated research"] = "AI-generated research"
    question: str
    symbols: list[str]
    generated_at: datetime
    provider: Literal["OpenAI via LangChain"] = "OpenAI via LangChain"
    model: str
    prompt_version: str
    sources: list[EvidenceSource]
    data_quality: list[str]
    disclaimer: str
