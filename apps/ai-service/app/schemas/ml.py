from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.analysis import Candle, StrictModel, Symbol

Label = Literal["UP", "DOWN", "NEUTRAL"]


class MarketHistory(StrictModel):
    symbol: Symbol
    bar_interval: Literal["1m", "5m", "15m", "1h", "1d"] = "1d"
    candles: list[Candle] = Field(min_length=100, max_length=50000)

    @model_validator(mode="after")
    def valid_history(self):
        if any(a.timestamp >= b.timestamp for a, b in zip(self.candles, self.candles[1:])):
            raise ValueError("Candles must be unique and chronological.")
        if any(candle.volume is None for candle in self.candles):
            raise ValueError("Trend classification requires observed volume on every candle.")
        return self


class PredictionRequest(MarketHistory):
    candles: list[Candle] = Field(min_length=100, max_length=2000)


class TrendPrediction(StrictModel):
    symbol: str
    as_of: datetime
    label: Label
    class_probabilities: dict[Label, float]
    model_name: str
    feature_version: str
    bar_interval: str
    horizon_observations: int
    neutral_return_threshold: float
    training_label_end: str
    limitations: list[str]
