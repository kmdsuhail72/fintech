from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.analysis import StrictModel, Symbol


class NewsArticle(StrictModel):
    symbol: Symbol
    headline: str = Field(min_length=1, max_length=300)
    articleSummary: str = Field(min_length=1, max_length=6000)
    language: Literal["en"] = "en"

    @model_validator(mode="before")
    @classmethod
    def summary_aliases(cls, values):
        if isinstance(values, dict) and "articleSummary" not in values:
            values = dict(values)
            for alias in ("article_summary", "summary"):
                if alias in values:
                    values["articleSummary"] = values.pop(alias)
                    break
        return values

    @property
    def article_summary(self) -> str:
        return self.articleSummary

    @field_validator("headline", "articleSummary")
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("News text cannot be blank.")
        return value


class NewsBatch(StrictModel):
    articles: list[NewsArticle] = Field(min_length=1, max_length=32)


class NewsSentiment(StrictModel):
    symbol: str
    sentiment: Literal["positive", "negative", "neutral"]
    confidence: float = Field(ge=0, le=1)
    summary: str
    keyTopics: list[str]


class BatchSentiment(StrictModel):
    results: list[NewsSentiment]
    count: int
    model: str
    revision: str
    confidence_method: str
    limitations: list[str]
