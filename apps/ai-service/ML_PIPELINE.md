# Experimental market trend classification

This pipeline compares Logistic Regression, Random Forest, and Gradient Boosting on chronological, single-symbol OHLCV data. It predicts a forward-return class rather than guaranteed prices, profit, or portfolio performance. A majority-class baseline is evaluated alongside the three models.

## Input and labels

Use CSV columns timestamp, open, high, low, close, volume. Timestamps must include a timezone, be unique, and be ascending. Candles must be completed. Prices and volumes must be finite; volume is required and may be zero. Use one instrument and one declared bar interval (1m, 5m, 15m, 1h, or 1d); maintain consistent adjustment and volume conventions. Weekend/session gaps are allowed. The service cannot verify whether the declared interval, source, or last candle is accurate.

Default labels use the return from close[t] to close[t + 5]:

- UP: forward return greater than +0.005 (0.5%).
- DOWN: forward return below -0.005 (-0.5%).
- NEUTRAL: return inside or on those thresholds.

Horizon is measured in observed candles, not calendar days. The final horizon rows have unknown targets and are excluded rather than assigned NEUTRAL. Horizon and thresholds are fixed before evaluation, not optimized on the holdout. Supply at least several hundred diverse candles; the first 99 rows are warm-up. Training requires all three classes, and every CV training fold requires at least 40 rows and two classes. More folds or longer horizons require more history.

## Features

| Feature              | Definition                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Returns              | Close-to-close fractional returns over 1 and 5 observations                                                    |
| SMA                  | Close / SMA 20 - 1 and close / SMA 50 - 1                                                                      |
| EMA                  | Close / EMA 20 - 1                                                                                             |
| RSI                  | Wilder RSI 14 divided by 100; flat prices produce 0.5                                                          |
| MACD                 | EMA 12 - EMA 26, its EMA 9 signal, and histogram, each divided by current close                                |
| Volatility           | Sample standard deviation of the last 20 log returns per observation, not annualized                           |
| Volume change        | Symmetric relative change: (current - previous) / (current + previous), zero if both are zero; bounded [-1, 1] |
| Zero-volume baseline | A flag indicating that the previous volume was zero                                                            |

Relative SMA/EMA/MACD features reduce sensitivity to absolute price scale. EMA, RSI, and MACD are recalculated within exactly the trailing 100 candles for each row, using first-close EMA initialization and Wilder RSI seeding. This fixed context makes inference from the latest 100 candles match the corresponding training row exactly. These ML features can differ slightly from the full-history descriptive technical module; they have a separate feature version. All features use only prices and volume available at the close of the current candle. There is no forward fill, backward fill, centered window, target-dependent selection, or full-dataset normalization.

## Leakage controls and evaluation

1. Construct causal features and future labels separately. Drop the warm-up and unknown-label tail. Remaining rows retain contiguous original observation indices.
2. Reserve the final 20% of labeled rows as the untouched chronological holdout; never shuffle or stratify time.
3. Purge a full label-horizon gap from the end of training. Every training label ends strictly before the first holdout feature timestamp.
4. Run expanding-window TimeSeriesSplit on training rows only, with gap=horizon. Explicit boundary checks ensure training targets end before validation begins. Historical feature windows can legitimately include earlier training observations; future labels cannot cross the split.
5. Clone the entire scikit-learn Pipeline in each fold. Logistic Regression's StandardScaler is fitted only on that fold's training data; tree models use no scaling. No resampling, imputation, or feature selection is fitted globally.
6. Select among the three models by mean training-only CV macro F1. Ties preserve declared model order. No holdout metric selects the model.
7. Fit each candidate on the purged training block and evaluate all candidates and the majority baseline once on the holdout. The serialized winner remains trained on that block; it is not refitted using holdout rows.

The evaluation report contains accuracy, macro F1, macro recall across all three classes, per-class precision/recall/F1/support, labeled confusion matrices, fold scores, class supports, split timestamps, purged row counts, seed, dependency versions, and an input dataset digest. Absent validation classes contribute zero to all-class macro F1/recall, so inspect support before interpreting scores. CV standard deviation describes fold variation and is not an independent confidence interval: time blocks and overlapping future labels are dependent.

Models use fixed experimental settings: Logistic Regression with balanced class weights and scaling; Random Forest with 120 trees, depth 6, minimum leaf 5, balanced weights; Gradient Boosting with 100 stages, depth 2, learning rate 0.05, minimum leaf 5. Seeds are fixed and the forest uses one worker. No hyperparameter tuning or probability calibration is performed.

## Train

From apps/ai-service in PowerShell after installing requirements:

```powershell
..\..\.venv\Scripts\python.exe -m app.train --csv history.csv --symbol AAPL --bar-interval 1d --output-dir artifacts/aapl-run-1 --horizon 5 --threshold 0.005 --test-fraction 0.2 --folds 4
```

The CLI writes trend-model.joblib and evaluation.json. It prints the selected model, comparison metrics, absolute model path, and SHA-256. Training is an offline operator action; no upload or training HTTP endpoint is exposed. Use a new output directory per experiment to retain provenance. CSV input is bounded to 50,000 rows.

No real-market dataset is bundled. A reproducible synthetic smoke test is available:

```powershell
..\..\.venv\Scripts\python.exe scripts/generate_ml_demo.py
..\..\.venv\Scripts\python.exe -m app.train --csv artifacts/demo/synthetic.csv --symbol DEMO --output-dir artifacts/demo
```

Synthetic scores validate mechanics only. The deliberately patterned demo is not evidence of performance on actual securities.

## Serialization and inference

Only deserialize artifacts created by trusted operators. Joblib/pickle can execute code on load. Set an absolute ML_MODEL_PATH and ML_MODEL_SHA256 from the training CLI in the service environment before starting or restarting Uvicorn. The pinned digest must come from a trusted channel; it checks exact bytes but is not a signature or proof that an arbitrary pickle is safe. The server validates the digest before deserialization, caps artifact size at 64 MiB, and checks the artifact/feature contract and exact NumPy/Pandas/scikit-learn/joblib versions. Artifacts are atomically published. Retrain on dependency changes.

POST /ml/trend/predict accepts:

```json
{
  "symbol": "AAPL",
  "bar_interval": "1d",
  "candles": []
}
```

Replace the empty placeholder with 100–2,000 completed candles containing all OHLCV fields. The symbol and interval must match the configured model; the final input timestamp must be later than its last training-label timestamp. Payloads cannot specify model paths or upload serialized models. An unconfigured or incompatible model returns 503; invalid history or domain mismatch returns 422. Existing analysis and health endpoints remain usable without an ML artifact.

The normal API envelope contains symbol, as_of, label, class_probabilities, model_name, feature_version, bar_interval, horizon_observations, neutral_return_threshold, training_label_end, and explicit limitations. Probabilities are uncalibrated class scores, not confidence or odds of investment profit. Inference does not train, refit a scaler, trade, or silently fall back to a synthetic model. Cached model loading is pinned by path and digest; restart to activate a newly configured artifact. Keep deployment behind the authenticated gateway described in README.md.

## Why accuracy is not guaranteed investment performance

Accuracy counts correctly classified labels, not money earned. A model can get many small moves right and lose money on a few large mistakes. Transaction costs, spreads, slippage, execution delays, liquidity, position sizing, and risk limits all affect realized results but are absent from a classification score. A NEUTRAL-heavy dataset can inflate raw accuracy without useful predictive skill, which is why this experiment also reports macro metrics and a baseline.

Historical relationships can disappear under regime change. Repeatedly inspecting the final holdout or changing the threshold/data/model after seeing its scores turns that holdout into training information. Survivorship bias, split/dividend adjustments, revised or retrospectively available data, and incomplete candles can create apparent skill even with correct code. Use point-in-time data, document its availability, preserve untouched future periods, and validate any proposed strategy separately with realistic execution and out-of-sample monitoring.

A correct predicted class does not specify a tradable entry, exit, or payoff. This pipeline has no profit objective or trading backtest, so never market its accuracy as a return guarantee. See [Investor.gov's AI investment alert](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/artificial-intelligence-fraud).

Implementation references: [scikit-learn leakage pitfalls](https://scikit-learn.org/stable/common_pitfalls.html), [TimeSeriesSplit and gap](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html), and [model persistence](https://scikit-learn.org/stable/model_persistence.html).

## Verification

Run the full service test suite with python -m pytest from apps/ai-service. ML tests verify future-data invariance, identical train/inference contexts, label-tail exclusion, zero-volume behavior, purged fold boundaries, training-only scaler fitting, holdout changes not influencing selection/CV, serialization round trips, digest rejection, domain/time guards, and inference endpoint behavior.
