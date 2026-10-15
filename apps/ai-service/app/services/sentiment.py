import re

import numpy as np

from app.schemas.analysis import SentimentAnalysis, SentimentItem, SentimentRequest

POSITIVE = frozenset("growth gain gains profit profits profitable beat beats strong upgrade bullish recovery recover record outperform innovation positive rise rises rising".split())
NEGATIVE = frozenset("loss losses decline declines declining weak downgrade bearish fraud lawsuit lawsuits risk risks miss misses negative fall falls falling bankruptcy debt recession".split())
NEGATORS = frozenset({"not", "no", "never", "without", "neither"})


def label(score: float) -> str:
    return "positive" if score > 0.1 else "negative" if score < -0.1 else "neutral"


def analyze_sentiment(request: SentimentRequest) -> SentimentAnalysis:
    items = []
    for index, text in enumerate(request.texts):
        # Reset the negation scope at punctuation to avoid carrying it across sentences.
        segments = re.split(r"[.!?;,:]", text.lower())
        weights, token_count = [], 0
        for segment in segments:
            tokens = re.findall(r"[a-z]+", segment)
            token_count += len(tokens)
            for offset, token in enumerate(tokens):
                weight = 1 if token in POSITIVE else -1 if token in NEGATIVE else 0
                if weight:
                    if any(term in NEGATORS for term in tokens[max(0, offset - 3):offset]):
                        weight *= -1
                    weights.append(weight)
        score = float(np.mean(weights)) if weights else 0.0
        items.append(SentimentItem(index=index, label=label(score), score=score,
                                   matched_terms=len(weights), token_count=token_count))
    score = float(np.mean([item.score for item in items]))
    return SentimentAnalysis(
        label=label(score), score=score, items=items,
        positive_count=sum(item.label == "positive" for item in items),
        negative_count=sum(item.label == "negative" for item in items),
        neutral_count=sum(item.label == "neutral" for item in items),
        limitations=[
            "Deterministic English financial lexicon with a three-token negation window; no trained language model is enabled.",
            "Scores are lexical polarity, not probabilities, confidence, or expected returns.",
            "Sarcasm, context, other languages, and unfamiliar vocabulary may be misclassified; unmatched text is neutral.",
            "The aggregate is the equally weighted mean of text scores; news accuracy and relevance are not verified.",
        ],
    )
