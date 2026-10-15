import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.services.technical_report import analyze_ohlcv


def rows(prices):
    return [
        {"timestamp": timestamp.isoformat(), "open": price, "high": price,
         "low": price, "close": price, "volume": 100}
        for timestamp, price in zip(pd.date_range("2026-01-01", periods=len(prices), tz="UTC"), prices)
    ]


def test_single_price_step_matches_known_indicator_values():
    result = analyze_ohlcv("AAPL", rows([100] * 49 + [120]))
    signals = {item["indicator"]: item for item in result["signals"]}
    assert set(result) == {"symbol", "trend", "rsi", "macd", "volatility", "signals", "summary"}
    assert signals["SMA 20"]["value"] == pytest.approx(101)
    assert signals["SMA 50"]["value"] == pytest.approx(100.4)
    assert signals["EMA 20"]["value"] == pytest.approx(100 + 20 * 2 / 21)
    assert signals["Momentum 20"]["value"] == pytest.approx(20)
    expected_macd = 20 * (2 / 13 - 2 / 27)
    assert result["macd"]["line"] == pytest.approx(expected_macd)
    assert result["macd"]["signal"] == pytest.approx(expected_macd * 0.2)
    assert result["macd"]["histogram"] == pytest.approx(expected_macd * 0.8)
    assert result["rsi"] == 100
    assert result["trend"] == "rising"
    assert len(signals) == 8
    assert all(item["explanation"] and item["observation"] for item in signals.values())
    assert "not annualized" in result["volatility"]
    assert "do not guarantee" in result["summary"]
    json.dumps(result, allow_nan=False)


def test_dataframe_and_records_produce_identical_reports_without_mutation():
    records = rows(list(range(100, 160)))
    frame = pd.DataFrame(records)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"])
    original = frame.copy(deep=True)
    assert analyze_ohlcv("AAPL", frame) == analyze_ohlcv("AAPL", records)
    pd.testing.assert_frame_equal(frame, original)


def test_flat_history_is_neutral_and_unavailable_sma_is_explicit():
    result = analyze_ohlcv("AAPL", rows([100] * 30))
    signals = {item["indicator"]: item for item in result["signals"]}
    assert result["trend"] == "flat"
    assert result["rsi"] == 50
    assert all(value == 0 for value in result["macd"].values())
    assert signals["EMA 20"]["value"] == 100
    assert signals["SMA 50"]["value"] is None
    assert "Unavailable" in signals["SMA 50"]["observation"]
    assert signals["Momentum 20"]["value"] == 0
    assert signals["Volatility"]["value"] == 0


@pytest.mark.parametrize("case", ["missing_volume", "unordered", "missing_close", "nan", "duplicate_columns"])
def test_invalid_ohlcv_is_rejected(case):
    records = rows([100] * 60)
    if case == "missing_volume":
        records[0].pop("volume")
    elif case == "missing_close":
        records[0].pop("close")
    elif case == "unordered":
        records.reverse()
    elif case == "nan":
        records[0]["close"] = float("nan")
    else:
        frame = pd.DataFrame(records)
        frame.columns = ["timestamp", "open", "high", "low", "close", "close"]
        with pytest.raises(ValueError, match="unique"):
            analyze_ohlcv("AAPL", frame)
        return
    with pytest.raises((ValueError, ValidationError)):
        analyze_ohlcv("AAPL", records)


def test_report_endpoint_uses_same_calculations_as_module():
    records = rows(list(range(100, 160)))
    with TestClient(app) as client:
        result = client.post("/analysis/technical/report", json={"symbol": "AAPL", "candles": records})
    assert result.status_code == 200
    assert result.json()["data"] == analyze_ohlcv("AAPL", records)
    assert "Educational" in result.json()["disclaimer"]
