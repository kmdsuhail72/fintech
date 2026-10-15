"""Exercise the configured real model through single and batch API routes."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app.main import app


def main():
    directory = Path(__file__).resolve().parents[1]
    payload = json.loads((directory / "examples/news-sentiment-batch.json").read_text())
    with TestClient(app) as client:
        single = client.post("/news/sentiment", json=payload["articles"][0])
        if single.status_code != 200:
            raise RuntimeError(f"Real model unavailable: HTTP {single.status_code}; warm the cache first.")
        batch = client.post("/news/sentiment/batch", json=payload)
        assert batch.status_code == 200, batch.text
        assert batch.json()["count"] == len(payload["articles"])
        first = batch.json()["results"][0]
        assert abs(single.json()["confidence"] - first["confidence"]) < 1e-5
        assert {key: value for key, value in single.json().items() if key != "confidence"} == {
            key: value for key, value in first.items() if key != "confidence"
        }
        for expected, result in zip(payload["articles"], batch.json()["results"]):
            assert result["symbol"] == expected["symbol"]
            assert result["sentiment"] in {"positive", "negative", "neutral"}
            assert 0 <= result["confidence"] <= 1
        # Exercise input longer than one BERT window without truncating its tail.
        long_article = {**payload["articles"][0],
            "articleSummary": "Revenue rose and profits increased. " * 100 + "The company lowered guidance."}
        long_result = client.post("/news/sentiment", json=long_article)
        assert long_result.status_code == 200, long_result.text
        output = directory / "artifacts/news-smoke"
        output.mkdir(parents=True, exist_ok=True)
        (output / "single.json").write_text(json.dumps(single.json(), indent=2))
        (output / "batch.json").write_text(json.dumps(batch.json(), indent=2))
        (output / "long-article.json").write_text(json.dumps(long_result.json(), indent=2))
        print(json.dumps({"real_model_smoke_passed": True, "model": batch.json()["model"],
            "revision": batch.json()["revision"],
            "results": [{"symbol": item["symbol"], "sentiment": item["sentiment"],
                         "confidence": item["confidence"]} for item in batch.json()["results"]]}, indent=2))


if __name__ == "__main__":
    main()
