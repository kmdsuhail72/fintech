"""Usage: python -m app.train --csv history.csv --symbol AAPL --output-dir artifacts/run-1"""
import argparse
import json
from pathlib import Path

import pandas as pd

from app.models.ml_training import TrainingConfig, save_experiment, train_experiment
from app.schemas.ml import MarketHistory


def main():
    parser = argparse.ArgumentParser(description="Experimental chronological market trend classification")
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--bar-interval", choices=["1m", "5m", "15m", "1h", "1d"], default="1d")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--horizon", type=int, default=5)
    parser.add_argument("--threshold", type=float, default=0.005)
    parser.add_argument("--test-fraction", type=float, default=0.2)
    parser.add_argument("--folds", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    try:
        # Bound records before allocating feature windows or fitting estimators.
        frame = pd.read_csv(args.csv, nrows=50001)
        history = MarketHistory.model_validate({"symbol": args.symbol, "bar_interval": args.bar_interval,
                                                "candles": frame.to_dict(orient="records")})
        artifact, report = train_experiment(history, TrainingConfig(
            horizon=args.horizon, threshold=args.threshold, test_fraction=args.test_fraction,
            folds=args.folds, seed=args.seed,
        ))
        path, digest = save_experiment(artifact, report, args.output_dir)
        print(json.dumps({
            "model_path": str(path.resolve()), "model_sha256": digest,
            "selected_model": artifact["metadata"]["model_name"],
            "comparison": {name: {"cv_macro_f1": result["cv_macro_f1_mean"],
                                   "holdout": result["holdout"]}
                           for name, result in report["comparison"].items()},
            "warning": "Experimental classification scores are not investment returns or guarantees.",
        }, indent=2, allow_nan=False))
    except (ValueError, OSError) as error:
        parser.exit(2, f"Training failed: {error}\n")


if __name__ == "__main__":
    main()
