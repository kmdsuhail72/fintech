"""Generate synthetic test data, NOT evidence of real-market performance."""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("artifacts/demo/synthetic.csv"))
    args = parser.parse_args()
    rng = np.random.default_rng(42)
    index = np.arange(700)
    returns = 0.005 * np.sin(index / 8) + rng.normal(0, 0.001, len(index))
    close = 100 * np.exp(np.cumsum(returns))
    opened = np.r_[close[0], close[:-1]]
    frame = pd.DataFrame({
        "timestamp": pd.date_range("2022-01-01", periods=len(index), tz="UTC").astype(str),
        "open": opened, "high": np.maximum(opened, close) * 1.002,
        "low": np.minimum(opened, close) * 0.998, "close": close,
        "volume": rng.integers(1000, 10000, len(index)),
    })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.output, index=False)
    print(f"Synthetic demonstration only: {args.output}")


if __name__ == "__main__":
    main()
