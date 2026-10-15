"""Load only operator-configured, digest-pinned, trusted local model artifacts."""
from functools import lru_cache
import hashlib
import hmac
from pathlib import Path
import re

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.pipeline import Pipeline

from app.models.ml_features import CONTEXT, FEATURES, FEATURE_VERSION, LABELS, engineer_features, history_frame
from app.schemas.ml import PredictionRequest, TrendPrediction


class ModelUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=2)
def load_model(path: str, expected_sha256: str):
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected_sha256):
        raise ModelUnavailable("A trusted artifact SHA-256 is required.")
    try:
        model_path = Path(path)
        if model_path.stat().st_size > 64 * 1024 * 1024:
            raise ModelUnavailable("Model artifact exceeds the supported size.")
        # Verify the exact bytes subsequently deserialized (avoid path-change races).
        payload = model_path.read_bytes()
        if not hmac.compare_digest(hashlib.sha256(payload).hexdigest(), expected_sha256.lower()):
            raise ModelUnavailable("Model artifact digest mismatch.")
        from io import BytesIO
        artifact = joblib.load(BytesIO(payload))
        metadata = artifact["metadata"]
        pipeline = artifact["pipeline"]
        current = {"numpy": np.__version__, "pandas": pd.__version__,
                   "sklearn": sklearn.__version__, "joblib": joblib.__version__}
        if any(metadata["versions"].get(name) != version for name, version in current.items()):
            raise ModelUnavailable("Model dependency versions do not match this runtime.")
        if not isinstance(pipeline, Pipeline):
            raise ModelUnavailable("Unsupported model pipeline.")
        input_stage = next(step for _, step in pipeline.steps if not isinstance(step, str))
        if (metadata["artifact_version"] != 1 or metadata["feature_version"] != FEATURE_VERSION
                or metadata["features"] != FEATURES or metadata["context_observations"] != CONTEXT
                or set(metadata["classes"]) != set(LABELS)
                or not isinstance(pipeline, Pipeline)
                or list(input_stage.feature_names_in_) != FEATURES
                or set(pipeline.classes_) != set(LABELS)):
            raise ModelUnavailable("Unsupported model feature contract.")
        return artifact
    except ModelUnavailable:
        raise
    except Exception as error:
        raise ModelUnavailable("Model artifact is missing or incompatible.") from error


def predict_trend(history: PredictionRequest, artifact: dict) -> TrendPrediction:
    metadata = artifact["metadata"]
    if history.symbol != metadata["symbol"]:
        raise ValueError("Input symbol must match the trained model.")
    if history.bar_interval != metadata["bar_interval"]:
        raise ValueError("Input bar interval must match the trained model.")
    as_of = history.candles[-1].timestamp
    if pd.Timestamp(as_of) <= pd.Timestamp(metadata["training_label_end"]):
        raise ValueError("Inference candle must be later than the last training label observation.")
    features = engineer_features(history_frame(history)).iloc[-1:]
    model = artifact["pipeline"]
    probabilities = model.predict_proba(features)[0]
    class_probabilities = {str(label): float(value) for label, value in zip(model.classes_, probabilities)}
    return TrendPrediction(
        symbol=history.symbol, as_of=as_of, label=str(model.predict(features)[0]),
        class_probabilities=class_probabilities, model_name=metadata["model_name"],
        feature_version=FEATURE_VERSION, bar_interval=metadata["bar_interval"],
        horizon_observations=metadata["config"]["horizon"],
        neutral_return_threshold=metadata["config"]["threshold"],
        training_label_end=metadata["training_label_end"],
        limitations=[
            "Experimental classification of forward returns over observed candles; not guaranteed future prices or investment performance.",
            "Class probabilities are uncalibrated model outputs, not reliable odds of profit.",
            "Input candles must be completed, consistently adjusted, and match training interval and volume semantics; these are caller responsibilities.",
            "Distribution drift, costs, spread, slippage, liquidity, and payoff asymmetry can invalidate apparent accuracy.",
            "This endpoint does not place orders or calculate an investable return.",
        ],
    )
