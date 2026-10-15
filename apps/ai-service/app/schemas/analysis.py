from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DISCLAIMER = (
    "Educational research only, not personalized investment advice. "
    "Historical patterns do not guarantee future performance."
)
Price = Annotated[float, Field(ge=1e-8, le=1e12, allow_inf_nan=False)]
Nonnegative = Annotated[float, Field(ge=0, le=1e15, allow_inf_nan=False)]
Symbol = Annotated[str, Field(pattern=r"^[A-Z0-9][A-Z0-9.:-]{0,19}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Candle(StrictModel):
    timestamp: datetime
    open: Price
    high: Price
    low: Price
    close: Price
    volume: Nonnegative | None = None

    @field_validator("timestamp")
    @classmethod
    def aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must include a timezone")
        return value

    @model_validator(mode="after")
    def valid_range(self):
        if self.low > min(self.open, self.close) or self.high < max(self.open, self.close):
            raise ValueError("OHLC prices must lie within low and high")
        return self


class TechnicalRequest(StrictModel):
    symbol: Symbol
    candles: list[Candle] = Field(min_length=30, max_length=2000)

    @model_validator(mode="after")
    def ordered_candles(self):
        times = [item.timestamp for item in self.candles]
        if any(left >= right for left, right in zip(times, times[1:])):
            raise ValueError("candles must have unique timestamps in ascending order")
        return self


class SentimentRequest(StrictModel):
    texts: list[Annotated[str, Field(min_length=1, max_length=5000)]] = Field(
        min_length=1, max_length=100
    )

    @field_validator("texts")
    @classmethod
    def nonempty_texts(cls, values: list[str]) -> list[str]:
        if any(not value.strip() for value in values):
            raise ValueError("texts cannot be blank")
        return values


class StockResearchRequest(TechnicalRequest):
    company_name: str | None = Field(default=None, min_length=1, max_length=120)
    headlines: list[Annotated[str, Field(min_length=1, max_length=5000)]] = Field(
        default_factory=list, max_length=100
    )

    @field_validator("headlines")
    @classmethod
    def nonempty_headlines(cls, values: list[str]) -> list[str]:
        if any(not value.strip() for value in values):
            raise ValueError("headlines cannot be blank")
        return values


class Position(StrictModel):
    symbol: Symbol
    quantity: Annotated[float, Field(ge=1e-8, le=1e12, allow_inf_nan=False)]
    average_cost: Price
    current_price: Price


class PortfolioResearchRequest(StrictModel):
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    cash: Nonnegative = 0
    positions: list[Position] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_symbols(self):
        symbols = [position.symbol for position in self.positions]
        if len(symbols) != len(set(symbols)):
            raise ValueError("positions must have unique symbols")
        return self


class Trend(StrictModel):
    method: Literal["ordinary-least-squares-log-close"] = "ordinary-least-squares-log-close"
    direction: Literal["rising", "falling", "flat"]
    log_slope_per_observation: float
    r_squared: float


class TechnicalAnalysis(StrictModel):
    symbol: str
    observations: int
    as_of: datetime
    last_close: float
    sma_20: float
    sma_50: float | None
    ema_20: float
    momentum_20_percent: float
    rsi_14: float
    macd: float
    macd_signal: float
    macd_histogram: float
    bollinger_lower: float
    bollinger_middle: float
    bollinger_upper: float
    observed_return_percent: float
    return_volatility_percent: float
    maximum_drawdown_percent: float
    trend: Trend
    observations_summary: list[str]
    limitations: list[str]


class SentimentItem(StrictModel):
    index: int
    label: Literal["positive", "negative", "neutral"]
    score: float = Field(ge=-1, le=1)
    matched_terms: int
    token_count: int


class SentimentAnalysis(StrictModel):
    method: Literal["english-financial-lexicon-v1"] = "english-financial-lexicon-v1"
    label: Literal["positive", "negative", "neutral"]
    score: float = Field(ge=-1, le=1)
    positive_count: int
    negative_count: int
    neutral_count: int
    items: list[SentimentItem]
    limitations: list[str]


class StockResearch(StrictModel):
    symbol: str
    company_name: str | None
    technical: TechnicalAnalysis
    sentiment: SentimentAnalysis | None
    summary: list[str]
    research_questions: list[str]
    limitations: list[str]


class Allocation(StrictModel):
    symbol: str
    market_value: float
    cost_basis: float
    unrealized_pnl: float
    unrealized_pnl_percent: float
    portfolio_weight_percent: float


class PortfolioResearch(StrictModel):
    currency: str
    cash: float
    holdings_value: float
    total_value: float
    cost_basis: float
    unrealized_pnl: float
    unrealized_pnl_percent: float | None
    cash_weight_percent: float | None
    largest_position_weight_percent: float | None
    holdings_concentration_hhi: float | None
    allocations: list[Allocation]
    observations: list[str]
    limitations: list[str]


T = TypeVar("T")


class AnalysisResponse(StrictModel, Generic[T]):
    ok: Literal[True] = True
    data: T
    generated_at: datetime
    request_id: str
    disclaimer: str = DISCLAIMER


class TechnicalSignal(StrictModel):
    indicator: str
    value: float | None
    observation: str
    explanation: str


class MACDReport(StrictModel):
    line: float
    signal: float
    histogram: float


class TechnicalReport(StrictModel):
    symbol: str
    trend: Literal["rising", "falling", "flat"]
    rsi: float
    macd: MACDReport
    volatility: str
    signals: list[TechnicalSignal]
    summary: str
