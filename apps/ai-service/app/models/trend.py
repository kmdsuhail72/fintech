import numpy as np
from sklearn.linear_model import LinearRegression

from app.schemas.analysis import Trend


def describe_trend(closes: np.ndarray) -> Trend:
    # Fit historical log closes only; this is a descriptive model, not a forecast.
    x = np.arange(len(closes), dtype=float).reshape(-1, 1)
    y = np.log(closes)
    model = LinearRegression().fit(x, y)
    slope = float(model.coef_[0])
    constant = bool(np.ptp(y) < 1e-12)
    return Trend(
        direction="flat" if abs(slope) < 1e-6 else "rising" if slope > 0 else "falling",
        log_slope_per_observation=slope,
        r_squared=0.0 if constant else float(np.clip(model.score(x, y), 0, 1)),
    )
