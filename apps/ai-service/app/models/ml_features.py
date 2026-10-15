"""Causal, fixed-context features shared by offline training and inference."""
import numpy as np
import pandas as pd

from app.schemas.ml import MarketHistory

CONTEXT = 100
FEATURE_VERSION = "ohlcv-causal-context100-v1"
FEATURES = [
    "return_1", "return_5", "sma_20_gap", "sma_50_gap", "ema_20_gap",
    "rsi_14", "macd_gap", "macd_signal_gap", "macd_histogram_gap",
    "volatility_20", "volume_change", "volume_zero_baseline",
]
LABELS = ["UP", "DOWN", "NEUTRAL"]


def history_frame(history: MarketHistory) -> pd.DataFrame:
    frame = pd.DataFrame([bar.model_dump() for bar in history.candles])
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    return frame


def engineer_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Each row uses only its trailing 100 completed candles, including itself.

    Input must be a validated, chronological single-symbol history_frame.
    No target column, future value, backward fill, or fitted transform is used.
    """
    close = frame["close"].astype(float)
    if len(close) < CONTEXT:
        raise ValueError("At least 100 completed candles are required.")
    windows = np.lib.stride_tricks.sliding_window_view(close.to_numpy(), CONTEXT)
    ema20, ema12, ema26 = (windows[:, 0].copy() for _ in range(3))
    signal = np.zeros(len(windows))
    changes = np.diff(windows, axis=1)
    gains = np.maximum(changes, 0)
    losses = np.maximum(-changes, 0)
    gain = gains[:, :14].mean(axis=1)
    loss = losses[:, :14].mean(axis=1)
    for column in range(1, CONTEXT):
        current = windows[:, column]
        ema20 += (2 / 21) * (current - ema20)
        ema12 += (2 / 13) * (current - ema12)
        ema26 += (2 / 27) * (current - ema26)
        signal += (2 / 10) * (ema12 - ema26 - signal)
    for column in range(14, CONTEXT - 1):
        gain = (13 * gain + gains[:, column]) / 14
        loss = (13 * loss + losses[:, column]) / 14
    rsi = np.full(len(windows), 50.0)
    np.divide(gain, gain + loss, out=rsi, where=(gain + loss) != 0)
    rsi[(gain + loss) != 0] *= 100
    tail_index = frame.index[CONTEXT - 1:]
    last = windows[:, -1]
    features = pd.DataFrame(index=tail_index)
    features["return_1"] = close.pct_change(fill_method=None).iloc[CONTEXT - 1:]
    features["return_5"] = close.pct_change(5, fill_method=None).iloc[CONTEXT - 1:]
    features["sma_20_gap"] = last / windows[:, -20:].mean(axis=1) - 1
    features["sma_50_gap"] = last / windows[:, -50:].mean(axis=1) - 1
    features["ema_20_gap"] = last / ema20 - 1
    features["rsi_14"] = rsi / 100
    macd = ema12 - ema26
    features["macd_gap"] = macd / last
    features["macd_signal_gap"] = signal / last
    features["macd_histogram_gap"] = (macd - signal) / last
    features["volatility_20"] = np.log(close).diff().rolling(20).std(ddof=1).iloc[CONTEXT - 1:]
    volume = frame["volume"].to_numpy(dtype=float)
    previous, current = volume[CONTEXT - 2:-1], volume[CONTEXT - 1:]
    # Symmetric relative change is bounded [-1, 1], including zero-volume bars.
    change = np.zeros(len(current))
    np.divide(current - previous, current + previous, out=change, where=(current + previous) > 0)
    features["volume_change"] = change
    features["volume_zero_baseline"] = (previous == 0).astype(float)
    features = features.loc[:, FEATURES]
    if not np.isfinite(features.to_numpy()).all():
        raise ValueError("Feature values must be finite.")
    return features


def build_dataset(history: MarketHistory, horizon: int, threshold: float):
    if not isinstance(horizon, int) or isinstance(horizon, bool) or not 1 <= horizon <= 20:
        raise ValueError("horizon must be an integer from 1 to 20.")
    if not np.isfinite(threshold) or not 0 < threshold < 0.2:
        raise ValueError("threshold must be between 0 and 0.2 as a decimal return.")
    frame = history_frame(history)
    features = engineer_features(frame)
    future_return = frame["close"].shift(-horizon) / frame["close"] - 1
    # Last horizon rows have no observed target: never label them NEUTRAL.
    eligible = features.index[features.index < len(frame) - horizon]
    features = features.loc[eligible]
    forward = future_return.loc[eligible]
    target = pd.Series(np.where(forward > threshold, "UP",
                       np.where(forward < -threshold, "DOWN", "NEUTRAL")), index=eligible)
    return frame, features, target
