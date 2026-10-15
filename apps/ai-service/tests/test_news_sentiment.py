from contextlib import nullcontext
from types import SimpleNamespace

from fastapi.testclient import TestClient
import numpy as np
import pytest
from pydantic import ValidationError

from app.main import app
from app.models.financial_nlp import (
    FinancialNLP, NewsInputTooLong, NewsModelConfig, NewsModelUnavailable,
)
from app.schemas.news import NewsArticle, NewsBatch
from app.services.news_sentiment import analyze_news, extract_summary, key_topics


def article(symbol="AAPL", **changes):
    return NewsArticle.model_validate({"symbol": symbol, "headline": "Earnings and revenue rise",
        "articleSummary": "Revenue increased and profits grew. Management raised guidance. Another sentence.", **changes})


class Predictor:
    def __init__(self, scores):
        self.scores = scores
        self.inputs = None

    def predict(self, texts):
        self.inputs = texts
        return self.scores


def test_requested_json_shape_confidence_and_extractive_summary():
    provider = Predictor([{"negative": 0.05, "neutral": 0.09, "positive": 0.86}])
    result = analyze_news([article()], provider)[0].model_dump()
    assert set(result) == {"symbol", "sentiment", "confidence", "summary", "keyTopics"}
    assert result["sentiment"] == "positive"
    assert result["confidence"] == 0.86
    assert result["summary"] == "Revenue increased and profits grew. Management raised guidance."
    assert set(result["keyTopics"]) == {"earnings", "revenue", "guidance"}
    assert "Earnings and revenue rise" in provider.inputs[0]
    assert "Another sentence." in provider.inputs[0]


def test_batch_keeps_article_order_and_real_neutral_scores():
    provider = Predictor([
        {"positive": 0.1, "negative": 0.8, "neutral": 0.1},
        {"positive": 0.05, "negative": 0.05, "neutral": 0.9},
    ])
    results = analyze_news([article("MSFT"), article("AAPL")], provider)
    assert [item.symbol for item in results] == ["MSFT", "AAPL"]
    assert [item.sentiment for item in results] == ["negative", "neutral"]
    assert [item.confidence for item in results] == [0.8, 0.9]


@pytest.mark.parametrize("scores", [
    [], [{"positive": 0.5}], [{"positive": float("nan"), "negative": 0.1, "neutral": 0.1}],
    [{"positive": 2.0, "negative": 0.0, "neutral": 0.0}],
    [{"positive": 0.2, "negative": 0.2, "neutral": 0.2}],
])
def test_invalid_model_scores_are_not_reported_as_confidence(scores):
    with pytest.raises(NewsModelUnavailable):
        analyze_news([article()], Predictor(scores))


def test_summary_and_topics_are_bounded_deterministic_extracts():
    original = "Word " * 200
    result = extract_summary(original)
    assert len(result) <= 600
    assert result.endswith("…")
    assert extract_summary("  Revenue   rose.  Costs fell. Third sentence. ") == "Revenue rose. Costs fell."
    assert key_topics("Acquisition, revenue, earnings, revenue, dividend, fraud") == [
        "mergers and acquisitions", "revenue", "earnings", "dividends", "litigation",
    ]
    assert key_topics("ordinary annual meeting") == []


@pytest.mark.parametrize("changes", [
    {"headline": " "}, {"articleSummary": " "}, {"headline": "a" * 301},
    {"articleSummary": "a" * 6001}, {"language": "fr"}, {"model": "untrusted"},
])
def test_invalid_article_inputs(changes):
    with pytest.raises(ValidationError):
        article(**changes)


def test_batch_limits_and_summary_aliases():
    for text_key in ["articleSummary", "article_summary", "summary"]:
        parsed = NewsArticle.model_validate({"symbol": "AAPL", "headline": "Update", text_key: "Meeting scheduled."})
        assert parsed.article_summary == "Meeting scheduled."
    with pytest.raises(ValidationError):
        NewsBatch(articles=[])
    with pytest.raises(ValidationError):
        NewsBatch(articles=[article()] * 33)


def test_routes_and_metadata_headers(monkeypatch):
    # Generate a correctly sized fake batch while keeping the real route/service contract.
    class SizedPredictor:
        def predict(self, texts):
            return [{"positive": 0.86, "negative": 0.05, "neutral": 0.09} for _ in texts]
    monkeypatch.setattr("app.services.news_sentiment.get_news_model", lambda _: SizedPredictor())
    with TestClient(app) as client:
        response = client.post("/news/sentiment", json=article().model_dump(mode="json", by_alias=True))
        assert response.status_code == 200
        assert response.json()["confidence"] == 0.86
        assert "data" not in response.json()
        assert response.headers["x-sentiment-model"] == "ProsusAI/finbert"
        assert "uncalibrated" in response.headers["x-confidence-method"]
        batch = client.post("/news/sentiment/batch", json={"articles": [
            article("MSFT").model_dump(mode="json", by_alias=True),
            article("AAPL").model_dump(mode="json", by_alias=True),
        ]})
        assert batch.status_code == 200
        assert batch.json()["count"] == 2
        assert [result["symbol"] for result in batch.json()["results"]] == ["MSFT", "AAPL"]
        assert batch.json()["limitations"]


@pytest.mark.parametrize("error,status", [(NewsModelUnavailable("Unavailable"), 503),
                                          (NewsInputTooLong("Too many tokens"), 422)])
def test_model_failures_are_explicit_without_lexicon_fallback(monkeypatch, error, status):
    class Broken:
        def predict(self, _):
            raise error
    monkeypatch.setattr("app.services.news_sentiment.get_news_model", lambda _: Broken())
    with TestClient(app) as client:
        response = client.post("/news/sentiment", json=article().model_dump(mode="json", by_alias=True))
        assert response.status_code == status
        assert response.json()["ok"] is False
        assert "confidence" not in response.json()
        if status == 503:
            assert response.headers["retry-after"] == "30"


class Tensor:
    def __init__(self, values):
        self.values = np.array(values)
    def cpu(self):
        return self
    def numpy(self):
        return self.values


class Tokenizer:
    def encode(self, text, **kwargs):
        assert kwargs["truncation"] is False
        return list(range(len(text.split())))
    def num_special_tokens_to_add(self, pair):
        return 2
    def __call__(self, texts, **kwargs):
        assert kwargs["truncation"] is True
        assert kwargs["return_overflowing_tokens"] is True
        assert kwargs["stride"] == 0
        result = {key: [] for key in ["input_ids", "attention_mask", "token_type_ids",
                  "special_tokens_mask", "overflow_to_sample_mapping"]}
        limit = kwargs["max_length"] - 2
        for owner, text in enumerate(texts):
            ids = list(range(len(text.split())))
            for start in range(0, len(ids), limit):
                piece = ids[start:start + limit]
                result["input_ids"].append([101] + piece + [102])
                result["attention_mask"].append([1] * (len(piece) + 2))
                result["token_type_ids"].append([0] * (len(piece) + 2))
                result["special_tokens_mask"].append([1] + [0] * len(piece) + [1])
                result["overflow_to_sample_mapping"].append(owner)
        return result
    def pad(self, chunks, **kwargs):
        return {"input_ids": [item["input_ids"] for item in chunks]}


def fake_nlp():
    model = FinancialNLP(NewsModelConfig(batch_size=2))
    model._tokenizer = Tokenizer()
    model._labels = ["negative", "neutral", "positive"]
    model._content_limit = 4
    def predict(**kwargs):
        scores = [[0.05, 0.05, 0.9] if ids[1] == 0 else [0.8, 0.1, 0.1]
                  for ids in kwargs["input_ids"]]
        return SimpleNamespace(logits=np.log(scores))
    def softmax(logits, dim):
        probabilities = np.exp(logits)
        return Tensor(probabilities / probabilities.sum(axis=-1, keepdims=True))
    model._model = predict
    model._torch = SimpleNamespace(inference_mode=nullcontext, softmax=softmax)
    return model


def test_chunked_inference_preserves_tail_and_uses_configured_label_mapping():
    model = fake_nlp()
    result = model.predict(["one two three four five six", "short text"])
    assert len(result) == 2
    assert result[0]["positive"] == pytest.approx((4 * 0.9 + 2 * 0.1) / 6)
    assert result[0]["negative"] == pytest.approx((4 * 0.05 + 2 * 0.8) / 6)
    assert result[1]["positive"] == pytest.approx(0.9)
    assert sum(result[0].values()) == pytest.approx(1)


def test_token_limit_busy_and_disabled_model_are_explicit():
    model = fake_nlp()
    with pytest.raises(NewsInputTooLong):
        model.predict(["word " * 8193])
    # Errors release the model lock, so the next request can proceed.
    assert model.predict(["short"])[0]["positive"] == pytest.approx(0.9)
    model._lock.acquire()
    try:
        with pytest.raises(NewsModelUnavailable, match="busy"):
            model.predict(["short"])
    finally:
        model._lock.release()
    with pytest.raises(NewsModelUnavailable, match="disabled"):
        FinancialNLP(NewsModelConfig(enabled=False)).warm()
    with pytest.raises(NewsModelUnavailable, match="pinned"):
        FinancialNLP(NewsModelConfig(revision="main")).warm()


def test_tokenizer_cannot_silently_discard_tail_tokens():
    model = fake_nlp()
    class TruncatingTokenizer(Tokenizer):
        def __call__(self, texts, **kwargs):
            encoded = super().__call__(texts, **kwargs)
            return {key: values[:1] for key, values in encoded.items()}
    model._tokenizer = TruncatingTokenizer()
    with pytest.raises(NewsModelUnavailable, match="full article"):
        model.predict(["one two three four five six"])


def test_default_cache_does_not_depend_on_launch_directory(tmp_path, monkeypatch):
    expected = NewsModelConfig().cache_dir
    monkeypatch.chdir(tmp_path)
    assert NewsModelConfig().cache_dir == expected
    assert NewsModelConfig(cache_dir=str(tmp_path)).cache_dir == str(tmp_path.resolve())
