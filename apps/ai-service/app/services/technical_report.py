"""Educational OHLCV analysis, usable independently of the HTTP API."""
from collections.abc import Mapping, Sequence
from typing import Any

import pandas as pd

from app.schemas.analysis import (
    DISCLAIMER, MACDReport, TechnicalAnalysis, TechnicalReport, TechnicalRequest, TechnicalSignal,
)
from app.services.technical import analyze_technical


def build_technical_report(analysis: TechnicalAnalysis) -> TechnicalReport:
    def average_observation(value: float | None) -> str:
        if value is None:
            return "Unavailable: supply at least 50 observations."
        relation = "above" if analysis.last_close > value else "below" if analysis.last_close < value else "equal to"
        return f"The latest close is {relation} this average."

    rsi_observation = (
        "Above 70: recent gains have dominated losses; often called overbought, not proof of a reversal."
        if analysis.rsi_14 > 70 else
        "Below 30: recent losses have dominated gains; often called oversold, not proof of a recovery."
        if analysis.rsi_14 < 30 else
        "Between 30 and 70: neither conventional RSI extreme is present."
    )
    histogram = analysis.macd_histogram
    macd_observation = (
        "The MACD line is above its signal line." if histogram > 0 else
        "The MACD line is below its signal line." if histogram < 0 else
        "The MACD line equals its signal line."
    )
    momentum = analysis.momentum_20_percent
    momentum_observation = (
        "The latest close is higher than 20 observations ago." if momentum > 0 else
        "The latest close is lower than 20 observations ago." if momentum < 0 else
        "The latest close equals the close 20 observations ago."
    )
    signals = [
        TechnicalSignal(
            indicator="SMA 20", value=analysis.sma_20,
            observation=average_observation(analysis.sma_20),
            explanation="The simple average of the last 20 closing prices. It smooths recent price changes, giving every close equal weight.",
        ),
        TechnicalSignal(
            indicator="SMA 50", value=analysis.sma_50,
            observation=average_observation(analysis.sma_50),
            explanation="The simple average of the last 50 closing prices. It shows a longer historical baseline than SMA 20; fewer than 50 observations produces null.",
        ),
        TechnicalSignal(
            indicator="EMA 20", value=analysis.ema_20,
            observation=average_observation(analysis.ema_20),
            explanation="A 20-period moving average that gives recent closes more weight. It responds faster than SMA 20 and is initialized from the first supplied close.",
        ),
        TechnicalSignal(
            indicator="RSI 14", value=analysis.rsi_14, observation=rsi_observation,
            explanation="A 0–100 measure comparing recent gains with losses using Wilder smoothing over 14 price changes. Flat prices give 50; only gains give 100; only losses give 0.",
        ),
        TechnicalSignal(
            indicator="MACD", value=histogram, observation=macd_observation,
            explanation="The MACD line is EMA 12 minus EMA 26. Its signal is a 9-period EMA of that line. The histogram is line minus signal; it describes their current difference, not a detected crossover or future move.",
        ),
        TechnicalSignal(
            indicator="Volatility", value=analysis.return_volatility_percent,
            observation=f"Historical log-return variability is {analysis.return_volatility_percent:.4g}% per observation.",
            explanation="The sample standard deviation of percentage log returns over all supplied closes. Larger values mean past changes varied more. This is not annualized and does not indicate direction or future risk with certainty.",
        ),
        TechnicalSignal(
            indicator="Momentum 20", value=momentum, observation=momentum_observation,
            explanation="The percentage change from the close 20 observations ago to the latest close: (latest / earlier - 1) × 100. Positive means a historical rise; negative means a historical fall.",
        ),
        TechnicalSignal(
            indicator="Trend", value=analysis.trend.log_slope_per_observation,
            observation=f"The fitted historical direction is {analysis.trend.direction}.",
            explanation="A straight line fitted to historical log closes summarizes direction over all supplied observations. Its slope is per observation; slopes within ±0.000001 are labeled flat. This is descriptive, not a price forecast.",
        ),
    ]
    return TechnicalReport(
        symbol=analysis.symbol, trend=analysis.trend.direction, rsi=analysis.rsi_14,
        macd=MACDReport(line=analysis.macd, signal=analysis.macd_signal, histogram=histogram),
        volatility=f"{analysis.return_volatility_percent:.4g}% per observation (historical log-return standard deviation; not annualized)",
        signals=signals,
        summary=(
            f"{analysis.symbol}: historical fitted trend is {analysis.trend.direction} across "
            f"{analysis.observations} observations, RSI 14 is {analysis.rsi_14:.2f}, and "
            f"20-observation momentum is {momentum:+.2f}%. "
            "Indicators may disagree and do not guarantee future prices. " + DISCLAIMER
        ),
    )


def analyze_ohlcv(
    symbol: str, data: pd.DataFrame | Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    """Return JSON-safe report for chronological OHLCV records or a DataFrame.

    Required columns: timestamp, open, high, low, close, volume. Timestamps
    must be timezone-aware; no sorting, forward-filling, or fabricated prices.
    Values and history length are validated with the shared API schema.
    """
    if isinstance(data, pd.DataFrame):
        if not data.columns.is_unique:
            raise ValueError("OHLCV columns must be unique.")
        records = data.to_dict(orient="records")
    else:
        records = list(data)
    required = {"timestamp", "open", "high", "low", "close", "volume"}
    if any(not isinstance(record, Mapping) or not required.issubset(record) for record in records):
        raise ValueError("Every OHLCV row requires timestamp, open, high, low, close, and volume.")
    payload = TechnicalRequest.model_validate({"symbol": symbol, "candles": records})
    return build_technical_report(analyze_technical(payload)).model_dump(mode="json")
