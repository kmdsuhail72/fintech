"""Financial article sentiment, extractive summaries, and deterministic topics."""
from functools import lru_cache
import re
from typing import Protocol

import numpy as np

from app.models.financial_nlp import (
    CONFIDENCE_METHOD, LABELS, FinancialNLP, NewsModelConfig, NewsModelUnavailable,
)
from app.schemas.news import BatchSentiment, NewsArticle, NewsSentiment

TOPICS = {
    "earnings": r"\b(earnings|profits?|eps|net income)\b",
    "revenue": r"\b(revenue|sales|turnover)\b",
    "guidance": r"\b(guidance|outlook|forecast|forecasts)\b",
    "mergers and acquisitions": r"\b(merger|mergers|acquisition|acquisitions|takeover)\b",
    "dividends": r"\b(dividends?|payout)\b",
    "share buybacks": r"\b(buybacks?|repurchase|repurchases)\b",
    "debt and financing": r"\b(debt|bonds?|financing|credit|liquidity|bankruptcy)\b",
    "regulation": r"\b(regulat(?:ion|ions|or|ors|ory)|antitrust|compliance)\b",
    "litigation": r"\b(lawsuits?|litigation|court|fraud|settlement)\b",
    "products": r"\b(products?|launch|launches|innovation)\b",
    "employment": r"\b(layoffs?|hiring|workforce|jobs)\b",
    "macroeconomics": r"\b(inflation|interest rates?|recession|central bank|tariffs?)\b",
}
LIMITATIONS = [
    "Confidence is an uncalibrated model softmax score, averaged by content-token count across chunks; not the probability of profit or verified correctness.",
    "FinBERT evaluates English financial language. Mixed signals, sarcasm, attribution, and distribution shift can cause errors.",
    "The symbol associates the result with caller-supplied news; sentiment is article-level, not entity-targeted. Multi-company stories may not describe that symbol's outlook.",
    "Summary is an extract from the supplied article summary, not generated fact-checking. Key topics use a fixed financial keyword taxonomy.",
    "News sentiment is educational analysis, not a guaranteed prediction or investment recommendation.",
]


class NewsPredictor(Protocol):
    def predict(self, texts: list[str]) -> list[dict[str, float]]: ...


def extract_summary(text: str, max_chars: int = 600) -> str:
    normalized = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?])\s+", normalized)
    excerpt = " ".join(sentences[:2])
    if len(excerpt) <= max_chars:
        return excerpt
    excerpt = excerpt[:max_chars - 1]
    if " " in excerpt:
        excerpt = excerpt.rsplit(" ", 1)[0]
    return excerpt + "…"


def key_topics(text: str) -> list[str]:
    matches = []
    for topic, pattern in TOPICS.items():
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            matches.append((match.start(), topic))
    return [topic for _, topic in sorted(matches)[:10]]


@lru_cache(maxsize=4)
def get_news_model(config: NewsModelConfig) -> FinancialNLP:
    return FinancialNLP(config)


def analyze_news(articles: list[NewsArticle], predictor: NewsPredictor) -> list[NewsSentiment]:
    texts = [article.headline + "\n" + article.article_summary for article in articles]
    scores = predictor.predict(texts)
    if len(scores) != len(articles):
        raise NewsModelUnavailable("Financial NLP result count does not match the batch.")
    results = []
    for article, text, probabilities in zip(articles, texts, scores):
        if (set(probabilities) != set(LABELS)
                or any(not np.isfinite(value) or not 0 <= value <= 1 for value in probabilities.values())
                or not np.isclose(sum(probabilities.values()), 1, atol=1e-6)):
            raise NewsModelUnavailable("Financial NLP returned invalid class scores.")
        sentiment = max(LABELS, key=lambda label: probabilities[label])
        results.append(NewsSentiment(
            symbol=article.symbol, sentiment=sentiment, confidence=probabilities[sentiment],
            summary=extract_summary(article.article_summary), keyTopics=key_topics(text),
        ))
    return results


def analyze_news_batch(articles: list[NewsArticle], config: NewsModelConfig) -> BatchSentiment:
    results = analyze_news(articles, get_news_model(config))
    return BatchSentiment(results=results, count=len(results), model=config.model_id,
                          revision=config.revision, confidence_method=CONFIDENCE_METHOD,
                          limitations=LIMITATIONS)
