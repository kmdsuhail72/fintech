from datetime import datetime, timedelta, timezone
import json

from fastapi.testclient import TestClient
import numpy as np
import pytest

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as instance:
        yield instance


def candles(prices):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [dict(timestamp=(start + timedelta(days=i)).isoformat(),
                 open=p, high=p, low=p, close=p, volume=100)
            for i, p in enumerate(prices)]


def technical_payload(prices=None):
    return {"symbol": "AAPL", "candles": candles(prices if prices is not None else [100.0] * 60)}


def data(response):
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert "Educational" in body["disclaimer"]
    assert body["request_id"] == response.headers["x-request-id"]
    assert body["generated_at"]
    json.dumps(body, allow_nan=False)
    return body["data"]


def test_health_and_compatibility(client):
    for path in ["/health", "/health/live", "/health/ready"]:
        assert client.get(path).json()["status"] == "ok"


def test_flat_prices_have_finite_neutral_indicators(client):
    result = data(client.post("/analysis/technical", json=technical_payload()))
    assert result["rsi_14"] == 50
    assert result["sma_20"] == result["sma_50"] == 100
    assert result["macd"] == result["maximum_drawdown_percent"] == 0
    assert result["bollinger_lower"] == result["bollinger_upper"] == 100
    assert result["return_volatility_percent"] == 0
    assert result["trend"]["direction"] == "flat"
    assert result["trend"]["r_squared"] == 0


def test_monotone_prices_and_partial_history(client):
    rising = data(client.post("/analysis/technical", json=technical_payload(list(range(100, 130)))))
    falling = data(client.post("/analysis/technical", json=technical_payload(list(range(130, 100, -1)))))
    assert rising["rsi_14"] == 100
    assert falling["rsi_14"] == 0
    assert rising["sma_50"] is None
    assert rising["trend"]["direction"] == "rising"
    assert falling["trend"]["direction"] == "falling"
    assert rising["observed_return_percent"] == pytest.approx(29)
    assert falling["maximum_drawdown_percent"] == pytest.approx(29 / 130 * 100)
    assert rising["sma_20"] == pytest.approx(119.5)


def test_volatility_matches_log_returns_without_annualization(client):
    prices = [100 + i % 7 for i in range(60)]
    result = data(client.post("/analysis/technical", json=technical_payload(prices)))
    assert result["return_volatility_percent"] == pytest.approx(np.std(np.diff(np.log(prices)), ddof=1) * 100)


@pytest.mark.parametrize("case", ["short", "reversed", "duplicate", "naive", "ohlc", "negative", "extra", "tiny"])
def test_invalid_candles_are_rejected_without_echoing_inputs(client, case):
    payload = technical_payload()
    if case == "short":
        payload["candles"] = payload["candles"][:29]
    elif case == "reversed":
        payload["candles"].reverse()
    elif case == "duplicate":
        payload["candles"][1]["timestamp"] = payload["candles"][0]["timestamp"]
    elif case == "naive":
        payload["candles"][0]["timestamp"] = "2026-01-01T00:00:00"
    elif case == "ohlc":
        payload["candles"][0]["high"] = 99
    elif case == "negative":
        payload["candles"][0]["close"] = -1
    elif case == "extra":
        payload["secret"] = "do-not-echo-this"
    else:
        payload["candles"][0]["close"] = 1e-300
    response = client.post("/analysis/technical", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["request_id"] == response.headers["x-request-id"]
    assert "do-not-echo-this" not in response.text
    assert all("input" not in item for item in response.json()["error"]["details"])


def test_sentiment_polarity_negation_and_unknown_vocabulary(client):
    result = data(client.post("/analysis/sentiment", json={"texts": [
        "Strong profit growth", "Weak losses and fraud", "Not strong", "ordinary meeting", "Not weak. Strong growth"
    ]}))
    assert [item["label"] for item in result["items"]] == ["positive", "negative", "negative", "neutral", "positive"]
    assert result["items"][3]["matched_terms"] == 0
    assert result["positive_count"] == 2
    assert result["negative_count"] == 2
    assert result["neutral_count"] == 1
    assert "confidence" not in result


@pytest.mark.parametrize("payload", [{"texts": []}, {"texts": [" "]}, {"texts": ["a" * 5001]}, {"texts": ["a"] * 101}])
def test_sentiment_limits(client, payload):
    assert client.post("/analysis/sentiment", json=payload).status_code == 422


def test_stock_research_with_and_without_headlines(client):
    payload = technical_payload()
    result = data(client.post("/research/stock", json=payload))
    assert result["sentiment"] is None
    payload.update(company_name="Example", headlines=["Strong profit growth"])
    result = data(client.post("/research/stock", json=payload))
    assert result["company_name"] == "Example"
    assert result["technical"]["symbol"] == "AAPL"
    assert result["sentiment"]["label"] == "positive"
    assert result["research_questions"]


def test_portfolio_weights_and_pnl(client):
    result = data(client.post("/research/portfolio", json={"currency": "USD", "cash": 100,
        "positions": [
            {"symbol": "AAPL", "quantity": 2, "average_cost": 50, "current_price": 100},
            {"symbol": "MSFT", "quantity": 1, "average_cost": 150, "current_price": 100},
        ]}))
    assert result["total_value"] == 400
    assert result["holdings_value"] == 300
    assert result["cost_basis"] == 250
    assert result["unrealized_pnl"] == 50
    assert result["unrealized_pnl_percent"] == pytest.approx(20)
    assert result["cash_weight_percent"] == 25
    assert result["largest_position_weight_percent"] == 50
    assert result["holdings_concentration_hhi"] == pytest.approx(5 / 9)
    assert sum(p["portfolio_weight_percent"] for p in result["allocations"]) + result["cash_weight_percent"] == pytest.approx(100)


def test_empty_and_cash_only_portfolios(client):
    empty = data(client.post("/research/portfolio", json={}))
    assert empty["total_value"] == 0
    assert empty["unrealized_pnl_percent"] is None
    assert empty["holdings_concentration_hhi"] is None
    assert empty["cash_weight_percent"] is None
    cash = data(client.post("/research/portfolio", json={"cash": 500}))
    assert cash["cash_weight_percent"] == 100
    assert cash["largest_position_weight_percent"] == 0


def test_duplicate_positions_and_nonfinite_prices_rejected(client):
    position = {"symbol": "AAPL", "quantity": 2, "average_cost": 50, "current_price": 100}
    assert client.post("/research/portfolio", json={"positions": [position, position]}).status_code == 422
    position["current_price"] = "NaN"
    assert client.post("/research/portfolio", json={"positions": [position]}).status_code == 422


def test_openapi_documents_all_response_models(client):
    spec = client.get("/openapi.json").json()
    for path in ["/analysis/technical", "/analysis/sentiment", "/research/stock", "/research/portfolio"]:
        assert "$ref" in spec["paths"][path]["post"]["responses"]["200"]["content"]["application/json"]["schema"]


def test_http_errors_are_structured(client):
    response = client.get("/missing")
    assert response.status_code == 404
    assert response.json()["ok"] is False
    assert response.json()["request_id"] == response.headers["x-request-id"]


def test_internal_error_does_not_expose_exception(monkeypatch):
    def fail(_):
        raise RuntimeError("private-input-do-not-expose")
    monkeypatch.setattr("app.api.routes.analyze_sentiment", fail)
    with TestClient(app, raise_server_exceptions=False) as instance:
        response = instance.post("/analysis/sentiment", json={"texts": ["growth"]})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "private-input-do-not-expose" not in response.text
    assert response.json()["request_id"] == response.headers["x-request-id"]


@pytest.mark.parametrize("prices", [[1e-8] * 60, [1e12] * 60, [1e-8, 1e12] * 30])
def test_extreme_allowed_prices_stay_json_finite(client, prices):
    data(client.post("/analysis/technical", json=technical_payload(prices)))


def test_example_payloads_match_documented_contracts(client):
    from pathlib import Path
    for name, endpoint in {
        "technical": "/analysis/technical", "sentiment": "/analysis/sentiment",
        "stock": "/research/stock", "portfolio": "/research/portfolio",
    }.items():
        payload = json.loads((Path(__file__).parent.parent / "examples" / f"{name}.json").read_text())
        data(client.post(endpoint, json=payload))
