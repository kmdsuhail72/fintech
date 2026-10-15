"""Offline experimental training; the final time block never selects the model."""
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, recall_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.ml_features import FEATURES, FEATURE_VERSION, LABELS, CONTEXT, build_dataset
from app.schemas.ml import MarketHistory


@dataclass(frozen=True)
class TrainingConfig:
    horizon: int = 5
    threshold: float = 0.005
    test_fraction: float = 0.2
    folds: int = 4
    seed: int = 42

    def validate(self):
        if not np.isfinite(self.test_fraction) or not 0.1 <= self.test_fraction <= 0.4:
            raise ValueError("test_fraction must be between 0.1 and 0.4.")
        if not isinstance(self.folds, int) or isinstance(self.folds, bool) or not 2 <= self.folds <= 6:
            raise ValueError("folds must be an integer from 2 to 6.")
        if not isinstance(self.seed, int) or isinstance(self.seed, bool) or not 0 <= self.seed <= 2**32 - 1:
            raise ValueError("seed must be an unsigned 32-bit integer.")


def candidate_models(seed: int):
    return {
        "logistic_regression": Pipeline([
            ("scale", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=2000, class_weight="balanced", random_state=seed)),
        ]),
        "random_forest": Pipeline([
            ("scale", "passthrough"),
            ("classifier", RandomForestClassifier(n_estimators=120, max_depth=6,
                min_samples_leaf=5, class_weight="balanced", random_state=seed, n_jobs=1)),
        ]),
        "gradient_boosting": Pipeline([
            ("scale", "passthrough"),
            ("classifier", GradientBoostingClassifier(n_estimators=100, max_depth=2,
                min_samples_leaf=5, learning_rate=0.05, random_state=seed)),
        ]),
    }


def chronological_split(samples: int, fraction: float, horizon: int):
    test_start = int(samples * (1 - fraction))
    train_end = test_start - horizon
    if train_end < 60 or samples - test_start < 20:
        raise ValueError("Insufficient labeled history for chronological train/test split.")
    return np.arange(train_end), np.arange(test_start, samples)


def evaluate(model, x, y):
    predicted = model.predict(x)
    return {
        "accuracy": float(accuracy_score(y, predicted)),
        "macro_f1": float(f1_score(y, predicted, labels=LABELS, average="macro", zero_division=0)),
        "macro_recall_all_classes": float(recall_score(y, predicted, labels=LABELS, average="macro", zero_division=0)),
        "confusion_matrix": confusion_matrix(y, predicted, labels=LABELS).tolist(),
        "confusion_matrix_labels": LABELS,
        "per_class": classification_report(y, predicted, labels=LABELS, output_dict=True, zero_division=0),
        "class_support": {label: int((y == label).sum()) for label in LABELS},
        "samples": len(y),
    }


def train_experiment(history: MarketHistory, config: TrainingConfig = TrainingConfig()):
    config.validate()
    frame, x, y = build_dataset(history, config.horizon, config.threshold)
    train, test = chronological_split(len(x), config.test_fraction, config.horizon)
    x_train, y_train = x.iloc[train], y.iloc[train]
    if set(y_train.unique()) != set(LABELS):
        raise ValueError("Training history must contain UP, DOWN, and NEUTRAL labels.")
    folds = list(TimeSeriesSplit(n_splits=config.folds, gap=config.horizon).split(x_train))
    for fold_train, _ in folds:
        if len(fold_train) < 40 or y_train.iloc[fold_train].nunique() < 2:
            raise ValueError("Every training fold needs at least 40 rows and two classes; supply more diverse history or fewer folds.")
    comparisons = {}
    fitted = {}
    fold_ranges = []
    for fold_train, validation in folds:
        train_row = int(x_train.index[fold_train[-1]])
        validation_row = int(x_train.index[validation[0]])
        if train_row + config.horizon >= validation_row:
            raise ValueError("Training target overlaps validation period.")
        fold_ranges.append({
            "training_feature_end": frame.loc[train_row, "timestamp"].isoformat(),
            "training_label_end": frame.loc[train_row + config.horizon, "timestamp"].isoformat(),
            "validation_start": frame.loc[validation_row, "timestamp"].isoformat(),
            "validation_end": frame.loc[int(x_train.index[validation[-1]]), "timestamp"].isoformat(),
            "training_rows": len(fold_train), "validation_rows": len(validation),
        })
    models = candidate_models(config.seed)
    models["majority_baseline"] = DummyClassifier(strategy="most_frequent")
    for name, template in models.items():
        scores = []
        for fold_train, validation in folds:
            # clone() creates fresh preprocessing and model state in every fold.
            model = clone(template).fit(x_train.iloc[fold_train], y_train.iloc[fold_train])
            scores.append(evaluate(model, x_train.iloc[validation], y_train.iloc[validation]))
        comparisons[name] = {
            "cv_macro_f1_mean": float(np.mean([score["macro_f1"] for score in scores])),
            "cv_macro_f1_std": float(np.std([score["macro_f1"] for score in scores])),
            "cv_folds": scores,
        }
    # Select before evaluating the holdout. Ties preserve declared model order.
    selected = max(candidate_models(config.seed), key=lambda name: comparisons[name]["cv_macro_f1_mean"])
    for name, template in models.items():
        model = clone(template).fit(x_train, y_train)
        fitted[name] = model
        comparisons[name]["holdout"] = evaluate(model, x.iloc[test], y.iloc[test])
    last_train_row = int(x_train.index[-1])
    metadata = {
        "artifact_version": 1, "symbol": history.symbol, "bar_interval": history.bar_interval, "model_name": selected,
        "feature_version": FEATURE_VERSION, "features": FEATURES, "classes": LABELS,
        "context_observations": CONTEXT, "config": asdict(config),
        "training_feature_end": frame.loc[last_train_row, "timestamp"].isoformat(),
        "training_label_end": frame.loc[last_train_row + config.horizon, "timestamp"].isoformat(),
        "holdout_start": frame.loc[int(x.index[test[0]]), "timestamp"].isoformat(),
        "holdout_end": frame.loc[int(x.index[test[-1]]), "timestamp"].isoformat(),
        "training_rows": len(train), "holdout_rows": len(test), "purged_rows": config.horizon,
        "dropped_warmup_rows": CONTEXT - 1, "dropped_unobserved_target_rows": config.horizon,
        "cv_boundaries": fold_ranges,
        "selected_by": "training-only chronological CV mean macro F1; never holdout accuracy",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "versions": {"python": platform.python_version(), "numpy": np.__version__,
                     "pandas": pd.__version__, "sklearn": sklearn.__version__, "joblib": joblib.__version__},
        "dataset_sha256": hashlib.sha256(history.model_dump_json().encode()).hexdigest(),
    }
    report = {
        "metadata": metadata, "comparison": comparisons,
        "limitations": [
            "This is an experimental label classifier, not a trading strategy or return guarantee.",
            "Features are available only after each input candle closes; execution at that same close is not assumed.",
            "Label horizon is in observed candles, not calendar days; probabilities are uncalibrated model outputs.",
            "Accuracy ignores payoff size, costs, spread, slippage, liquidity, drawdowns, and position sizing.",
            "Market regimes change. Repeated holdout inspection, biased data selection, and retrospective revisions can invalidate results.",
            "Macro metrics include all three classes; absent validation classes receive zero in macro F1/recall. Inspect support counts.",
            "CV folds and overlapping forward labels are dependent; score dispersion is not an independent confidence interval.",
        ],
    }
    return {"pipeline": fitted[selected], "metadata": metadata}, report


def save_experiment(artifact: dict, report: dict, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "trend-model.joblib"
    # Atomic publication avoids exposing a partially written pickle to inference.
    temporary = output_dir / ".trend-model.joblib.tmp"
    joblib.dump(artifact, temporary, compress=3)
    temporary.replace(model_path)
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    report = {**report, "artifact_sha256": digest}
    (output_dir / "evaluation.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    return model_path, digest
