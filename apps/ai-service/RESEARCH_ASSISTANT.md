# Asteriq AI research assistant

The web `/research` workspace calls authenticated `POST /api/v1/ai/research/assistant`, which forwards the session to `POST /research/assistant` on the Python service. LangChain `ChatOpenAI` uses strict structured output with seven sections: Summary, Market Context, Technical Analysis, News Sentiment, Potential Risks, Potential Opportunities, and Educational Conclusion.

## Run

Install `python -m pip install -r apps/ai-service/requirements.txt -r apps/ai-service/requirements-assistant.txt`. Set `OPENAI_API_KEY` only in the server environment and optionally `OPENAI_RESEARCH_MODEL`. Start the services with `npm run dev`, then sign in and open `/research`. Docker installs the assistant dependencies and uses internal service URLs automatically; set `OPENAI_API_KEY` before `docker compose up --build`.

For local FinBERT analysis, also install `requirements-news.txt` and warm the model as described in `NEWS_SENTIMENT.md`. Without that model, available stored sentiment is used; gaps remain explicit.

Example request (use an authenticated bearer token):

```json
{
  "question": "Compare AAPL and MSFT.",
  "symbols": ["AAPL", "MSFT"],
  "interval": "1d",
  "include_portfolio": false
}
```

Ticker and company-name inference support questions such as “Explain RSI for Tesla.” Portfolio questions retrieve only the current session's paper holdings. Explicitly selecting the portfolio checkbox also includes holdings. The UI discloses that selected evidence is sent to OpenAI.

## Evidence and limits

Research combines instrument metadata, prices, completed historical candles, computed technical indicators, news sentiment, and paper portfolio concentration. Every report includes source IDs, source availability, observation timestamps, data limitations, model and prompt metadata, and a fixed AI-generated research label and disclaimer. Existing market prices are simulated; reports disclose this. Company information currently consists of registry metadata, not verified financial statements or valuations. Missing history, news, and prices are never replaced with fabricated figures.

The prompt separates facts from interpretation, treats news and questions as untrusted input, avoids causal claims without evidence, and prohibits profit guarantees. Output validation rejects unknown citations and common performance-certainty claims. This is a safeguard, not proof that model output is accurate; users should verify research independently. Private identity and session tokens are excluded from model input, and implicit LangSmith tracing is disabled.

Run offline checks with `python -m pytest apps/ai-service/tests/test_research_assistant.py`. No OpenAI requests or charges are needed for these tests. A live generation check requires a configured key, authenticated API, and populated market data.
