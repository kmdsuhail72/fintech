# Asteriq AI research microservice

FastAPI, Pandas, NumPy, and scikit-learn; Python 3.11+. The deterministic analysis endpoints use caller-supplied data and require no LLM credentials. The authenticated research assistant and document embeddings require a server-side OpenAI key and their optional requirements files. Research is educational, not personalized advice or guaranteed returns.

## Run

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/ai-service/requirements.txt -r apps/ai-service/requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir apps/ai-service --host 127.0.0.1 --port 8000
```

Interactive documentation: http://127.0.0.1:8000/docs. The existing Docker Compose service works unchanged. Copy .env.example to .env in the working directory to override settings. From apps/ai-service, run tests with:

```powershell
..\..\.venv\Scripts\python.exe -m pytest -q
```

## Endpoints

| Endpoint                 | Input                                            | Result                                                                                                                                 |
| ------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET /health              | None                                             | status, service                                                                                                                        |
| POST /analysis/technical | symbol, candles                                  | SMA 20/50, EMA 20, momentum 20, RSI 14, MACD 12/26/9, Bollinger bands, historical return, volatility, drawdown, descriptive regression |
| POST /analysis/sentiment | texts                                            | Per-text and aggregate English lexical sentiment                                                                                       |
| POST /research/stock     | symbol, candles, optional company_name/headlines | Technical analysis, optional sentiment, summary, research questions                                                                    |
| POST /research/portfolio | currency, cash, positions                        | Allocation, unrealized P/L, cash weight, holdings concentration HHI                                                                    |

Health aliases /health/live and /health/ready are retained. Analysis successes contain ok, data, generated_at, request_id, and disclaimer. X-Request-Id is included in all responses. Validation errors return 422 with ok=false, request_id, and error(code/message/details); details expose paths and codes without input values. Unexpected failures return a generic 500 error. Typed response models appear in OpenAPI.

Candles require 30–2,000 unique timezone-aware timestamps in ascending order; open/high/low/close must be finite, between 1e-8 and 1e12, and consistent with the range. Optional volume is nonnegative. SMA 50 is null when fewer than 50 observations are available. Sentiment accepts 1–100 nonblank texts, each at most 5,000 characters. Portfolio positions require unique symbols, positive quantities/costs/prices, and a single already-converted currency. Numeric strings from the existing REST backend are accepted. Empty portfolios are valid; undefined ratios are null.

## Examples

The examples directory contains ready-to-send JSON. From the repository root:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/analysis/technical -Method Post -ContentType application/json -InFile apps/ai-service/examples/technical.json
Invoke-RestMethod http://127.0.0.1:8000/analysis/sentiment -Method Post -ContentType application/json -InFile apps/ai-service/examples/sentiment.json
Invoke-RestMethod http://127.0.0.1:8000/research/stock -Method Post -ContentType application/json -InFile apps/ai-service/examples/stock.json
Invoke-RestMethod http://127.0.0.1:8000/research/portfolio -Method Post -ContentType application/json -InFile apps/ai-service/examples/portfolio.json
```

Example candles are synthetic fixtures, not current prices.

## Methods and limits

RSI uses Wilder smoothing seeded with the first 14 changes; constant prices yield neutral RSI 50. MACD uses first-close EMA initialization, so short histories have warm-up effects. Bollinger bands use 20 closes and population standard deviation. Drawdown is peak-to-trough over supplied prices. Volatility is sample standard deviation of log returns per observation, never annualized.

scikit-learn LinearRegression fits historical log closes against observation index. Slope is per observation, not per day. R-squared measures in-sample fit, never forecast confidence. No future price predictions are generated.

Sentiment uses a deterministic English financial lexicon with a three-token negation window reset at punctuation. Scores in [-1, 1] are polarity, not probabilities or confidence. Aggregate scores equally weight texts. Context, sarcasm, unfamiliar terms, and other languages can fail. Unmatched text is neutral; absent stock headlines produce null sentiment.

Portfolio HHI sums squared invested holding weights, excludes cash, and measures concentration rather than market risk. Floating-point analytics do not replace the authoritative decimal ledger. Snapshot inputs cannot establish historical correlations, sector diversification, realized P/L, fees, taxes, or risk-adjusted returns. Freshness, source, news accuracy, and fundamentals are not independently verified.

## Organization and integration

app/api contains routes, app/schemas contains validated contracts, app/services contains analysis logic, app/models contains the descriptive regression, and app/utils contains response envelopes. CPU analysis runs in synchronous FastAPI endpoints through the worker thread pool.

Node API/worker callers can submit market OHLC candles and position snapshots. This implementation does not add persistence, research scheduling, alert evaluation, or frontend wiring. Optional OpenAI, LangChain, and Hugging Face providers are not enabled.

Deploy behind the authenticated API gateway on a private network. The microservice does not own accounts or authenticate users; configure gateway body/concurrency/rate limits and TLS before public exposure. Every research response includes its educational disclaimer and method limitations.

## Reusable technical analysis

[Technical analysis module](TECHNICAL_ANALYSIS.md) documents Python/DataFrame usage, the compact `/analysis/technical/report` endpoint, and plain-English explanations of every requested indicator.

## Experimental trend classification

[ML pipeline runbook](ML_PIPELINE.md) covers causal feature engineering, purged chronological training/CV, three-model comparison, offline serialization, and `/ml/trend/predict`. No model is activated by default; synthetic smoke-test results are not real-market evidence.

## Financial news sentiment

[News sentiment runbook](NEWS_SENTIMENT.md) documents the pinned local FinBERT model, single-article and batch endpoints, confidence semantics, model warm-up, extractive summaries, and key topics. Install requirements-news.txt and warm the cache to enable model inference.

# Research assistant

The authenticated web research workspace uses LangChain and OpenAI to combine market, technical, news, historical, and paper portfolio evidence. See [setup, API, and limitations](RESEARCH_ASSISTANT.md).

Document ingestion, OpenAI embeddings, pgvector retrieval, and cited question answering are described in [Document RAG](RAG.md).
