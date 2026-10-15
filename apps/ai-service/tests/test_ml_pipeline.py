import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
import numpy as np
import pandas as pd
import pytest

from app.main import app
from app.models.ml_features import (
    CONTEXT, FEATURES, build_dataset, engineer_features, history_frame,
)
from app.models.ml_training import TrainingConfig, train_experiment, save_experiment
from app.schemas.ml import MarketHistory, PredictionRequest
from app.services.ml_inference import ModelUnavailable, load_model, predict_trend


def history(count=600):
    rng = np.random.default_rng(42)
    index = np.arange(count)
    close = 100 * np.exp(np.cumsum(0.005 * np.sin(index / 8) + rng.normal(0, 0.001, count)))
    times = pd.date_range("2022-01-01", periods=count, tz="UTC")
    return MarketHistory(symbol="AAPL", candles=[{
        "timestamp": timestamp, "open": price, "high": price, "low": price, "close": price,
        "volume": int(volume),
    } for timestamp, price, volume in zip(times, close, rng.integers(1000, 10000, count))])


@pytest.fixture(scope="module")
def experiment():
    source = history()
    config = TrainingConfig(folds=3)
    artifact, report = train_experiment(source, config)
    return source, config, artifact, report


def test_future_price_and_volume_changes_cannot_change_past_features():
    frame = history_frame(history(350))
    original = engineer_features(frame)
    changed = frame.copy()
    changed.loc[250:, "close"] *= 10
    changed.loc[250:, "volume"] *= 7
    altered = engineer_features(changed)
    pd.testing.assert_frame_equal(original.loc[:249], altered.loc[:249])
    assert not original.loc[250:].equals(altered.loc[250:])
    assert list(original.columns) == FEATURES
    assert len(original) == 350 - CONTEXT + 1


def test_latest_inference_features_equal_training_features_with_same_context():
    frame = history_frame(history(350))
    full = engineer_features(frame).iloc[-1].to_numpy()
    tail = engineer_features(frame.tail(CONTEXT).reset_index(drop=True)).iloc[-1].to_numpy()
    np.testing.assert_allclose(full, tail, atol=1e-12, rtol=1e-12)


def test_target_uses_future_returns_and_drops_unknown_tail():
    source = history(200)
    frame, x, y = build_dataset(source, 5, 0.005)
    assert len(x) == len(frame) - 99 - 5
    assert x.index[-1] == len(frame) - 6
    for row in x.index:
        returned = frame.loc[row + 5, "close"] / frame.loc[row, "close"] - 1
        assert y.loc[row] == ("UP" if returned > 0.005 else "DOWN" if returned < -0.005 else "NEUTRAL")


def test_sma_rsi_macd_and_volume_features_on_constant_history():
    source = history(150)
    frame = history_frame(source)
    frame["close"] = 100.0
    frame["volume"] = 0
    features = engineer_features(frame)
    assert np.isfinite(features.to_numpy()).all()
    assert (features["rsi_14"] == 0.5).all()
    assert (features["sma_20_gap"] == 0).all()
    assert (features["sma_50_gap"] == 0).all()
    assert (features["ema_20_gap"] == 0).all()
    assert (features["macd_gap"] == 0).all()
    assert (features["volatility_20"] == 0).all()
    assert (features["volume_change"] == 0).all()
    assert (features["volume_zero_baseline"] == 1).all()
    frame.loc[149, "volume"] = 100
    assert engineer_features(frame).iloc[-1]["volume_change"] == 1


def test_cv_and_holdout_targets_do_not_overlap(experiment):
    _, config, artifact, report = experiment
    meta = artifact["metadata"]
    assert pd.Timestamp(meta["training_label_end"]) < pd.Timestamp(meta["holdout_start"])
    assert meta["purged_rows"] == config.horizon
    for fold in meta["cv_boundaries"]:
        assert pd.Timestamp(fold["training_label_end"]) < pd.Timestamp(fold["validation_start"])
    comparison = report["comparison"]
    assert set(comparison) == {"logistic_regression", "random_forest", "gradient_boosting", "majority_baseline"}
    selected = max(["logistic_regression", "random_forest", "gradient_boosting"],
                   key=lambda name: comparison[name]["cv_macro_f1_mean"])
    assert selected == meta["model_name"]
    for result in comparison.values():
        assert len(result["cv_folds"]) == 3
        assert np.asarray(result["holdout"]["confusion_matrix"]).shape == (3, 3)
        assert sum(result["holdout"]["class_support"].values()) == meta["holdout_rows"]


def test_scaler_is_fit_only_on_training_rows(experiment):
    source, config, _, report = experiment
    from app.models.ml_training import candidate_models, chronological_split
    _, x, y = build_dataset(source, config.horizon, config.threshold)
    train, _ = chronological_split(len(x), config.test_fraction, config.horizon)
    model = candidate_models(config.seed)["logistic_regression"].fit(x.iloc[train], y.iloc[train])
    np.testing.assert_allclose(model.named_steps["scale"].mean_, x.iloc[train].mean().to_numpy())
    assert not np.allclose(model.named_steps["scale"].mean_, x.mean().to_numpy())


def test_changing_holdout_cannot_change_model_selection_or_cv_scores(experiment):
    source, config, artifact, report = experiment
    changed = source.model_dump(mode="json")
    start = pd.Timestamp(artifact["metadata"]["holdout_start"])
    for row in changed["candles"]:
        if pd.Timestamp(row["timestamp"]) >= start:
            for key in ["open", "high", "low", "close"]:
                row[key] *= 2
            row["volume"] *= 3
    other_artifact, other_report = train_experiment(MarketHistory.model_validate(changed), config)
    assert other_artifact["metadata"]["model_name"] == artifact["metadata"]["model_name"]
    for name in report["comparison"]:
        assert other_report["comparison"][name]["cv_macro_f1_mean"] == report["comparison"][name]["cv_macro_f1_mean"]
        assert other_report["comparison"][name]["cv_folds"] == report["comparison"][name]["cv_folds"]


def test_serialization_round_trip_and_digest_pinning(experiment, tmp_path):
    source, _, artifact, report = experiment
    path, digest = save_experiment(artifact, report, tmp_path)
    assert digest == hashlib.sha256(path.read_bytes()).hexdigest()
    restored = load_model(str(path), digest)
    payload = PredictionRequest.model_validate(source.model_dump())
    expected = predict_trend(payload, artifact)
    assert predict_trend(payload, restored) == expected
    assert set(expected.class_probabilities) == {"UP", "DOWN", "NEUTRAL"}
    assert sum(expected.class_probabilities.values()) == pytest.approx(1)
    assert "uncalibrated" in " ".join(expected.limitations)
    with pytest.raises(ModelUnavailable, match="digest"):
        load_model(str(path), "0" * 64)
    with pytest.raises(ModelUnavailable, match="SHA"):
        load_model(str(path), "not-a-digest")


def test_inference_rejects_domain_and_time_mismatches(experiment):
    source, _, artifact, _ = experiment
    data = source.model_dump()
    with pytest.raises(ValueError, match="symbol"):
        predict_trend(PredictionRequest.model_validate({**data, "symbol": "MSFT"}), artifact)
    with pytest.raises(ValueError, match="interval"):
        predict_trend(PredictionRequest.model_validate({**data, "bar_interval": "5m"}), artifact)
    data["candles"] = data["candles"][:150]
    with pytest.raises(ValueError, match="later"):
        predict_trend(PredictionRequest.model_validate(data), artifact)


def test_inference_api_and_unconfigured_state(experiment, tmp_path, monkeypatch):
    source, _, artifact, report = experiment
    path, digest = save_experiment(artifact, report, tmp_path)
    with TestClient(app) as client:
        monkeypatch.setattr(app.state, "ml_model_config", (None, None))
        assert client.post("/ml/trend/predict", json=source.model_dump(mode="json")).status_code == 503
        monkeypatch.setattr(app.state, "ml_model_config", (str(path), digest))
        result = client.post("/ml/trend/predict", json=source.model_dump(mode="json"))
        assert result.status_code == 200, result.text
        assert result.json()["data"]["label"] in {"UP", "DOWN", "NEUTRAL"}
        assert result.json()["request_id"] == result.headers["x-request-id"]
        invalid = {**source.model_dump(mode="json"), "model_path": "untrusted.joblib"}
        assert client.post("/ml/trend/predict", json=invalid).status_code == 422


@pytest.mark.parametrize("horizon,threshold", [(0, 0.005), (21, 0.005), (True, 0.005), (5, 0), (5, float("nan"))])
def test_invalid_label_configuration_is_rejected(horizon, threshold):
    with pytest.raises(ValueError):
        build_dataset(history(150), horizon, threshold)


def test_training_requires_class_diversity():
    data = history().model_dump()
    for row in data["candles"]:
        row.update(open=100, high=100, low=100, close=100)
    with pytest.raises(ValueError, match="UP, DOWN, and NEUTRAL"):
        train_experiment(MarketHistory.model_validate(data))


@pytest.mark.parametrize("name", ["logistic_regression", "random_forest", "gradient_boosting"])
def test_each_candidate_can_be_serialized_and_loaded(name, experiment, tmp_path):
    from app.models.ml_training import candidate_models, chronological_split
    source, config, selected, report = experiment
    _, x, y = build_dataset(source, config.horizon, config.threshold)
    train, _ = chronological_split(len(x), config.test_fraction, config.horizon)
    model = candidate_models(config.seed)[name].fit(x.iloc[train], y.iloc[train])
    artifact = {"pipeline": model, "metadata": {**selected["metadata"], "model_name": name}}
    path, digest = save_experiment(artifact, report, tmp_path / name)
    restored = load_model(str(path), digest)
    payload = PredictionRequest.model_validate(source.model_dump())
    assert predict_trend(payload, restored) == predict_trend(payload, artifact)
