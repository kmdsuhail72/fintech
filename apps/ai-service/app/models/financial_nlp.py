"""Pinned financial NLP model with bounded, full-text chunked CPU inference."""
from dataclasses import dataclass
import re
from pathlib import Path
from threading import Lock

import numpy as np

LABELS = ("positive", "negative", "neutral")
DEFAULT_MODEL = "ProsusAI/finbert"
DEFAULT_REVISION = "4556d13015211d73dccd3fdd39d39232506f3e43"
CONFIDENCE_METHOD = "token-weighted mean chunk softmax; uncalibrated"


class NewsModelUnavailable(RuntimeError):
    pass


class NewsInputTooLong(ValueError):
    pass


@dataclass(frozen=True)
class NewsModelConfig:
    enabled: bool = True
    model_id: str = DEFAULT_MODEL
    revision: str = DEFAULT_REVISION
    cache_dir: str = "artifacts/huggingface"
    local_files_only: bool = True
    batch_size: int = 8

    def __post_init__(self):
        service_root = Path(__file__).resolve().parents[2]
        cache = (service_root / self.cache_dir).resolve()
        object.__setattr__(self, "cache_dir", str(cache))


class FinancialNLP:
    def __init__(self, config: NewsModelConfig):
        self.config = config
        self._lock = Lock()
        self._tokenizer = None
        self._model = None
        self._torch = None
        self._labels = None
        self._content_limit = None

    @property
    def ready(self) -> bool:
        return self._model is not None

    def _load(self):
        if not self.config.enabled:
            raise NewsModelUnavailable("Financial NLP sentiment is disabled.")
        if self.ready:
            return
        if not re.fullmatch(r"[a-f0-9]{40}", self.config.revision):
            raise NewsModelUnavailable("Financial NLP requires a pinned model commit revision.")
        if not 1 <= self.config.batch_size <= 32:
            raise NewsModelUnavailable("Financial NLP batch size must be between 1 and 32.")
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
            arguments = dict(revision=self.config.revision, cache_dir=self.config.cache_dir,
                             local_files_only=self.config.local_files_only, trust_remote_code=False)
            tokenizer = AutoTokenizer.from_pretrained(self.config.model_id, **arguments)
            model = AutoModelForSequenceClassification.from_pretrained(
                self.config.model_id, use_safetensors=False, **arguments,
            )
            labels = [str(model.config.id2label[i]).lower() for i in range(model.config.num_labels)]
            if len(labels) != 3 or set(labels) != set(LABELS):
                raise ValueError("Model must identify positive, negative, and neutral labels explicitly.")
            token_limit = min(512, int(model.config.max_position_embeddings))
            content_limit = token_limit - tokenizer.num_special_tokens_to_add(pair=False)
            if content_limit < 16:
                raise ValueError("Model token window is unsupported.")
            model.to("cpu")
            model.eval()
            self._tokenizer, self._model, self._torch = tokenizer, model, torch
            self._labels, self._content_limit = labels, content_limit
        except Exception as error:
            raise NewsModelUnavailable(
                "Financial NLP model is unavailable. Install requirements-news.txt and warm the pinned model cache."
            ) from error

    def warm(self):
        with self._lock:
            self._load()

    def predict(self, texts: list[str]) -> list[dict[str, float]]:
        if not self._lock.acquire(blocking=False):
            raise NewsModelUnavailable("Financial NLP is busy. Retry later.")
        try:
            self._load()
            expected_counts = []
            for text in texts:
                ids = self._tokenizer.encode(text, add_special_tokens=False, truncation=False)
                if not ids or len(ids) > 8192:
                    raise NewsInputTooLong("Each article must contain between 1 and 8192 model tokens.")
                expected_counts.append(len(ids))
            # Native overflow returns all windows; stride=0 avoids double-counting.
            encoded = self._tokenizer(
                texts, add_special_tokens=True, truncation=True,
                max_length=self._content_limit + self._tokenizer.num_special_tokens_to_add(pair=False),
                stride=0, return_overflowing_tokens=True, return_special_tokens_mask=True,
                return_attention_mask=True, return_token_type_ids=True, padding=False,
            )
            chunks, owners, weights = [], [], []
            coverage = np.zeros(len(texts), dtype=int)
            for index, owner in enumerate(encoded["overflow_to_sample_mapping"]):
                owner = int(owner)
                if not 0 <= owner < len(texts):
                    raise NewsModelUnavailable("Financial NLP returned an invalid chunk owner.")
                piece = {key: encoded[key][index] for key in (
                    "input_ids", "attention_mask", "token_type_ids",
                ) if key in encoded}
                weight = len(piece["input_ids"]) - sum(encoded["special_tokens_mask"][index])
                if weight <= 0:
                    raise NewsInputTooLong("Article chunks must contain text tokens.")
                chunks.append(piece)
                owners.append(owner)
                weights.append(weight)
                coverage[owner] += weight
            if not np.array_equal(coverage, expected_counts):
                raise NewsModelUnavailable("Financial NLP did not cover the full article input.")
            totals = np.zeros((len(texts), 3), dtype=float)
            counts = np.zeros(len(texts), dtype=float)
            with self._torch.inference_mode():
                for start in range(0, len(chunks), self.config.batch_size):
                    inputs = self._tokenizer.pad(
                        chunks[start:start + self.config.batch_size], padding=True, return_tensors="pt",
                    )
                    logits = self._model(**inputs).logits
                    probabilities = self._torch.softmax(logits, dim=-1).cpu().numpy()
                    if probabilities.shape != (len(inputs["input_ids"]), 3):
                        raise NewsModelUnavailable("Financial NLP returned an invalid prediction shape.")
                    for offset, values in enumerate(probabilities):
                        index = start + offset
                        totals[owners[index]] += values * weights[index]
                        counts[owners[index]] += weights[index]
            results = totals / counts[:, None]
            if not np.isfinite(results).all() or (results < 0).any():
                raise NewsModelUnavailable("Financial NLP returned invalid class scores.")
            results /= results.sum(axis=1, keepdims=True)
            return [{label: float(score) for label, score in zip(self._labels, row)} for row in results]
        except (NewsInputTooLong, NewsModelUnavailable):
            raise
        except Exception as error:
            raise NewsModelUnavailable("Financial NLP inference failed. Retry later.") from error
        finally:
            self._lock.release()
