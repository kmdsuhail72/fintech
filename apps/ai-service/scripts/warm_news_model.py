"""Cache the pinned financial NLP model before serving news requests."""
import argparse
import json
from pathlib import Path
import sys

# Running this file directly should resolve app from the service directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import settings
from app.models.financial_nlp import FinancialNLP, NewsModelConfig, NewsModelUnavailable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Allow the pinned model to be downloaded from Hugging Face.")
    args = parser.parse_args()
    config = NewsModelConfig(
        enabled=settings.news_sentiment_enabled, model_id=settings.news_sentiment_model,
        revision=settings.news_sentiment_revision, cache_dir=settings.news_sentiment_cache_dir,
        local_files_only=not args.download, batch_size=settings.news_sentiment_batch_size,
    )
    try:
        model = FinancialNLP(config)
        model.warm()
        print(json.dumps({"ready": model.ready, "model": config.model_id,
                          "revision": config.revision, "cache_dir": config.cache_dir}))
    except NewsModelUnavailable as error:
        parser.exit(1, f"Model warm-up failed: {error}\n")


if __name__ == "__main__":
    main()
