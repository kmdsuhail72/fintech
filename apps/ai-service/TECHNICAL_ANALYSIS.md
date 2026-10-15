# Technical analysis module

Use app.services.technical_report.analyze_ohlcv with a symbol and historical OHLCV records or a Pandas DataFrame. The module returns a JSON-safe dictionary with exactly these fields: symbol, trend, rsi, macd, volatility, signals, summary. Each signals entry contains indicator, value, observation, and explanation. These are descriptive observations, not trade instructions.

## Python usage

Run from apps/ai-service using the repository virtual environment:

```python
import json
import pandas as pd
from app.services.technical_report import analyze_ohlcv

# Columns: timestamp, open, high, low, close, volume.
# Timestamps must include a timezone; prices must be finite and positive.
frame = pd.read_csv("history.csv")
report = analyze_ohlcv("AAPL", frame)
print(json.dumps(report, indent=2, allow_nan=False))
```

Alternatively, pass a list of dictionaries from the historical REST candle response. Every row requires all six OHLCV fields; volume can be null when unavailable. Timestamps may be ISO strings or timezone-aware Pandas timestamps. Supply 30–2,000 candles in strictly increasing time order. Missing prices, duplicate timestamps, inconsistent OHLC ranges, and nonfinite values are rejected. The module does not sort, fill gaps, or mutate DataFrames. Extra columns are rejected by the shared validation schema.

The same compact report is available as POST /analysis/technical/report with {symbol, candles}. HTTP returns the existing success envelope with the report in data. Existing /analysis/technical and /research/stock responses retain their fields and now also include ema_20 and momentum_20_percent.

## Plain-English indicators

| Indicator   | Meaning and calculation                                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMA 20      | Average of the last 20 closing prices. Each close counts equally; it smooths recent changes.                                                                                                                                     |
| SMA 50      | Average of the last 50 closing prices. It gives a longer historical baseline; null when fewer than 50 candles are supplied.                                                                                                      |
| EMA 20      | A moving average giving recent closes more weight. Each new result is 2/21 of the new close plus 19/21 of the prior result, seeded with the first supplied close.                                                                |
| RSI 14      | Compares recent gains and losses on a 0–100 scale using Wilder smoothing. Above 70 and below 30 are common extreme labels, not proof of a reversal. Flat prices give 50.                                                         |
| MACD        | EMA 12 minus EMA 26. The signal line smooths MACD with EMA 9. Histogram equals line minus signal; a positive histogram means the line is above its signal, not that a new crossover occurred.                                    |
| Volatility  | How much historical log returns vary, measured by their sample standard deviation times 100. It is per observation, not annualized; larger values describe more variable past moves, not a direction.                            |
| Momentum 20 | Percentage change from the close 20 observations earlier: (latest / earlier - 1) × 100. Positive describes a past rise; negative describes a past fall.                                                                          |
| Trend       | A fitted straight line through log closing prices summarizes historical direction. Its slope is per observation; absolute slope below 0.000001 is flat, positive is rising, negative is falling. It is not a future-price model. |

“20” and “50” mean observations, not days, unless inputs are daily candles. Trend uses the entire supplied window; momentum uses 20 intervals, so they can disagree. EMA and MACD use first-close initialization and can differ from platforms using longer warm-up history. RSI is seeded with average gains/losses from the first 14 changes, then recursively smoothed with weight 1/14.

The volatility string reports the numerical percentage and measurement basis rather than inventing low/medium/high thresholds without an instrument-specific benchmark. Exact numerical volatility appears in its signals entry. Trend's numerical signal value is the log-price slope, not a return prediction. SMA/EMA and MACD values use the same price units as the input; momentum and volatility are percentages.

All requested indicators are based on closes. Open/high/low are validated and volume is accepted, but this implementation does not claim a volume-confirmed signal. The existing detailed analysis also retains Bollinger bands and historical drawdown.

## Limits

Caller-supplied prices and timestamps are not independently verified. Missing trading periods are not fabricated; gaps and irregular cadence affect per-observation comparisons. No universal risk category or confidence score is inferred. Indicators describe history, can disagree, and cannot guarantee future prices. Responses are educational research, not personalized investment advice.

Formula references: [Fidelity indicator guide](https://www.fidelity.com/learning-center/trading-investing/technical-analysis), [Wilder RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI), and [Pandas exponential-window behavior](https://pandas.pydata.org/pandas-docs/stable/reference/api/pandas.DataFrame.ewm.html).
