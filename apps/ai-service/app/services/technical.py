import numpy as np
import pandas as pd

from app.models.trend import describe_trend
from app.schemas.analysis import TechnicalAnalysis, TechnicalRequest


def analyze_technical(request: TechnicalRequest) -> TechnicalAnalysis:
    close = pd.Series([bar.close for bar in request.candles], dtype="float64")
    values = close.to_numpy()
    changes = close.diff().iloc[1:]
    gains = np.maximum(changes.to_numpy(), 0)
    losses = np.maximum(-changes.to_numpy(), 0)
    # Wilder's recursive smoothing, seeded by the first 14 price changes.
    gain, loss = float(gains[:14].mean()), float(losses[:14].mean())
    for next_gain, next_loss in zip(gains[14:], losses[14:]):
        gain = (13 * gain + float(next_gain)) / 14
        loss = (13 * loss + float(next_loss)) / 14
    rsi = 50.0 if gain == loss == 0 else 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    middle = float(close.iloc[-20:].mean())
    deviation = float(close.iloc[-20:].std(ddof=0))
    log_returns = np.diff(np.log(values))
    drawdown = values / np.maximum.accumulate(values) - 1
    trend = describe_trend(values)
    limitations = [
        "Analysis uses only caller-supplied observations; freshness and source are not independently verified.",
        "Volatility is sample standard deviation of log returns per observation, not annualized.",
        "Trend describes historical log prices; R-squared is in-sample fit, not prediction accuracy.",
        "MACD uses first-close EMA initialization; short histories have warm-up effects.",
        "Indicator thresholds are descriptive and are not buy or sell instructions.",
    ]
    if len(close) < 50:
        limitations.append("SMA 50 is unavailable with fewer than 50 observations.")
    return TechnicalAnalysis(
        symbol=request.symbol, observations=len(close), as_of=request.candles[-1].timestamp,
        last_close=float(values[-1]), sma_20=middle,
        sma_50=float(close.iloc[-50:].mean()) if len(close) >= 50 else None,
        ema_20=float(close.ewm(span=20, adjust=False).mean().iloc[-1]),
        momentum_20_percent=float((values[-1] / values[-21] - 1) * 100),
        rsi_14=float(rsi), macd=float(macd.iloc[-1]), macd_signal=float(signal.iloc[-1]),
        macd_histogram=float((macd - signal).iloc[-1]),
        bollinger_lower=middle - 2 * deviation, bollinger_middle=middle,
        bollinger_upper=middle + 2 * deviation,
        observed_return_percent=float((values[-1] / values[0] - 1) * 100),
        return_volatility_percent=float(np.std(log_returns, ddof=1) * 100),
        maximum_drawdown_percent=float(-drawdown.min() * 100), trend=trend,
        observations_summary=[
            f"Historical fitted trend is {trend.direction} over {len(close)} observations.",
            "RSI is above 70." if rsi > 70 else "RSI is below 30." if rsi < 30 else "RSI is between 30 and 70.",
            "Last close is above SMA 20." if values[-1] > middle else "Last close is at or below SMA 20.",
        ], limitations=limitations,
    )
