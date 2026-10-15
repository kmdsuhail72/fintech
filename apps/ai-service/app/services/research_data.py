"""Read-only, request-scoped evidence retrieval from the existing owner-scoped API."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import re
from urllib.parse import urlparse

import httpx
from app.observability import trace_headers
from pydantic import ValidationError

from app.schemas.analysis import Candle, PortfolioResearchRequest, TechnicalRequest
from app.schemas.assistant import AssistantRequest, EvidenceSource
from app.schemas.news import NewsArticle
from app.services.research import research_portfolio
from app.services.technical import analyze_technical
from app.services.technical_report import build_technical_report
from app.services.news_sentiment import analyze_news, get_news_model
from app.models.financial_nlp import NewsModelUnavailable


class ResearchDataError(RuntimeError):
    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


class BackendReader:
    def __init__(self, client: httpx.AsyncClient, bearer_token: str):
        self.client = client
        self.token = bearer_token
        self.limit = asyncio.Semaphore(6)

    async def get(self, path: str, params=None):
        async with self.limit:
            try:
                async with self.client.stream("GET", path, params=params,
                    headers={"Authorization": "Bearer " + self.token, **trace_headers()}) as result:
                    if result.status_code in (401, 403):
                        raise ResearchDataError("Sign in with an active Asteriq session to request research.", 401)
                    content = bytearray()
                    async for chunk in result.aiter_bytes(chunk_size=65536):
                        if len(content) + len(chunk) > 2_000_000:
                            raise ResearchDataError("Research source exceeds the supported size.")
                        content.extend(chunk)
                    payload = json.loads(content)
                if not result.is_success or not isinstance(payload, dict) or payload.get("ok") is not True or "data" not in payload:
                    raise ResearchDataError("A research data source is unavailable.")
                return payload["data"]
            except ResearchDataError:
                raise
            except (httpx.HTTPError, ValueError) as error:
                raise ResearchDataError("A research data source is unavailable.") from error

    async def authenticate(self):
        profile = await self.get("users/me")
        if not isinstance(profile, dict) or not profile.get("id"):
            raise ResearchDataError("A valid Asteriq session is required.", 401)
        # Never pass identity, email, access tokens, or auth response bodies to the LLM.
        return profile["id"]

    async def optional(self, path: str, params=None):
        try:
            return await self.get(path, params)
        except ResearchDataError as error:
            if error.status == 401:
                raise
            return None


def source(id, kind, title, data=None, as_of=None, url=None):
    if url and (urlparse(url).scheme not in {"http", "https"} or urlparse(url).username):
        url = None
    return EvidenceSource(id=id, kind=kind, title=title, available=data is not None,
                          as_of=as_of, url=url, data=data or {})


def infer_symbols(question, registry):
    matches = []
    for record in registry:
        symbol = str(record.get("symbol", ""))
        company = str(record.get("company_name", ""))
        words = re.findall(r"[a-zA-Z]+", company)
        aliases = [symbol] + [word for word in words if len(word) >= 4 and word.lower() not in {
            "corporation", "company", "incorporated", "holdings", "group", "class", "limited", "trust",
        }]
        found = [re.search(r"(?<![A-Za-z0-9])" + re.escape(alias) + r"(?![A-Za-z0-9])", question, re.I)
                 for alias in aliases if alias]
        found = [match.start() for match in found if match]
        if found and symbol:
            matches.append((min(found), symbol))
    return list(dict.fromkeys(symbol for _, symbol in sorted(matches)))


async def collect_evidence(request: AssistantRequest, reader: BackendReader, news_config):
    warnings = [
        "Company metadata is limited to the instrument registry; verified business descriptions, financial statements, valuations, and sector data are not supplied.",
        "Historical correlations, causal price drivers, and future performance are not established by these sources.",
    ]
    registry = await reader.get("market/symbols", {"limit": 100, "offset": 0})
    if not isinstance(registry, list):
        raise ResearchDataError("Company metadata is unavailable.")
    include_portfolio = request.include_portfolio
    if include_portfolio is None:
        include_portfolio = bool(re.search(r"\b(portfolio|my holdings|my positions)\b", request.question, re.I))
    portfolios = await reader.get("portfolio") if include_portfolio else None
    symbols = list(request.symbols) or infer_symbols(request.question, registry)
    if len(symbols) > 4:
        raise ResearchDataError("Select at most four symbols for focused research.", 422)
    if not symbols and portfolios:
        symbols = list(dict.fromkeys(position["symbol"] for portfolio in portfolios
            for position in portfolio.get("positions", []) if position.get("symbol")))[:4]
        warnings.append("Detailed market context covers up to four holdings; portfolio concentration uses all supplied positions.")
    if not symbols and not include_portfolio:
        raise ResearchDataError("Specify supported symbols for this question, or ask about your portfolio.", 422)
    companies = {}
    for symbol in symbols:
        matches = [record for record in registry if record.get("symbol") == symbol]
        if not matches:
            found = await reader.get("market/symbols", {"q": symbol, "limit": 100, "offset": 0})
            matches = [record for record in found if record.get("symbol") == symbol] if isinstance(found, list) else []
        if len(matches) != 1:
            raise ResearchDataError("One or more symbols are not registered. Specify supported symbols.", 422)
        companies[symbol] = matches[0]

    async def stock_sources(symbol):
        company = companies[symbol]
        records = [source(f"company:{symbol}", "company", f"{symbol} instrument metadata", {
            key: company.get(key) for key in ["symbol", "company_name", "exchange_code", "asset_type", "quote_currency", "country_code"]
        })]
        query = str(company.get("company_name", symbol)).split()[0] or symbol
        quote, history, articles, stored = await asyncio.gather(
            reader.optional(f"market/quotes/{symbol}"),
            reader.optional(f"market/quotes/{symbol}/candles", {"interval": request.interval, "limit": 200}),
            reader.optional("market/news", {"q": query, "limit": 5, "offset": 0}),
            reader.optional("ai/news-sentiment", {"symbol": symbol, "limit": 5, "offset": 0}),
        )
        if isinstance(quote, dict):
            data = {key: quote.get(key) for key in ["symbol", "price", "open", "high", "low", "previousClose", "change", "changePercent", "volume", "currency", "quoteStatus", "source", "timestamp"]}
            records.append(source(f"quote:{symbol}", "market", f"{symbol} latest price", data, data.get("timestamp")))
            if data.get("quoteStatus") == "SIMULATED" or data.get("source") == "synthetic-simulator":
                warnings.append(f"{symbol} prices are simulated educational data, not exchange prices.")
            try:
                observed = datetime.fromisoformat(str(data["timestamp"]).replace("Z", "+00:00"))
                if observed.tzinfo is None or datetime.now(timezone.utc) - observed > timedelta(minutes=5):
                    warnings.append(f"{symbol} quote is stale or timestamp cannot establish freshness.")
            except (ValueError, TypeError):
                warnings.append(f"{symbol} quote freshness is unavailable.")
        else:
            records.append(source(f"quote:{symbol}", "market", f"{symbol} latest price"))
        bars = []
        if isinstance(history, dict):
            duration = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400}[request.interval]
            try:
                for row in history.get("candles", []):
                    candle = Candle.model_validate({key: row.get(key) for key in ["timestamp", "open", "high", "low", "close", "volume"]})
                    if candle.timestamp + timedelta(seconds=duration) <= datetime.now(timezone.utc):
                        bars.append(candle)
                if len(bars) >= 30:
                    analysis = analyze_technical(TechnicalRequest(symbol=symbol, candles=bars))
                    records.append(source(f"technical:{symbol}", "technical", f"{symbol} indicators", build_technical_report(analysis).model_dump(mode="json"), analysis.as_of.isoformat()))
                    records.append(source(f"history:{symbol}", "history", f"{symbol} sampled historical trends", {
                        "interval": request.interval, "source": history.get("source"), "observations": len(bars),
                        "start": bars[0].timestamp.isoformat(), "end": bars[-1].timestamp.isoformat(),
                        "observed_return_percent": analysis.observed_return_percent,
                        "maximum_drawdown_percent": analysis.maximum_drawdown_percent,
                        "trend": analysis.trend.model_dump(),
                    }, analysis.as_of.isoformat()))
            except (ValidationError, ValueError, TypeError, KeyError):
                bars = []
        if not any(record.kind == "technical" for record in records):
            records.append(source(f"technical:{symbol}", "technical", f"{symbol} indicators"))
            records.append(source(f"history:{symbol}", "history", f"{symbol} historical trends"))
            warnings.append(f"{symbol} has fewer than 30 valid completed candles or history is unavailable; no indicator values were fabricated.")
        warnings.append(f"{symbol} history uses sampled OHLC bars; gaps are omitted and the current unfinished bar is excluded.")
        raw_news = articles if isinstance(articles, list) else []
        news_inputs, news_records = [], []
        for index, article in enumerate(raw_news[:5]):
            headline = str(article.get("headline", ""))[:300]
            summary = str(article.get("summary") or "")[:6000]
            if not headline.strip() or not summary.strip():
                continue
            news_inputs.append(NewsArticle(symbol=symbol, headline=headline, articleSummary=summary))
            news_records.append((index, article))
        sentiment = None
        if news_inputs:
            try:
                sentiment = await asyncio.to_thread(analyze_news, news_inputs, get_news_model(news_config))
            except (NewsModelUnavailable, ValueError):
                warnings.append(f"{symbol} local FinBERT sentiment is unavailable; stored analysis may be incomplete.")
        for position, (index, article) in enumerate(news_records):
            data = {"headline": str(article["headline"])[:300], "summary": str(article.get("summary") or "")[:1500],
                    "publisher": str(article.get("source") or "unknown")[:120], "published_at": article.get("published_at"),
                    "association": "caller-selected company text search; not entity-targeted sentiment"}
            if sentiment:
                data["sentiment"] = sentiment[position].model_dump()
                data["sentiment_model"] = news_config.model_id
                data["sentiment_revision"] = news_config.revision
            elif article.get("sentiment") is not None:
                data["stored_sentiment"] = str(article.get("sentiment"))[:20]
                data["stored_confidence"] = article.get("sentiment_confidence")
                data["sentiment_method"] = "stored upstream analysis; model/calibration not provided"
            records.append(source(f"news:{symbol}:{index}", "news", f"{symbol} supplied news", data,
                                  article.get("published_at"), article.get("canonical_url")))
        if not news_records and isinstance(stored, list) and stored:
            records.append(source(f"sentiment:{symbol}", "news", f"{symbol} stored sentiment", {
                "articles": [{key: row.get(key) for key in ["headline", "label", "score", "confidence", "published_at", "analyzed_at"]} for row in stored[:5]],
                "method": "stored analysis; model/calibration and article summary unavailable",
            }))
        if not any(record.kind == "news" for record in records):
            records.append(source(f"news:{symbol}", "news", f"{symbol} financial news sentiment"))
            warnings.append(f"No financial news sentiment is available for {symbol}.")
        return records

    grouped = await asyncio.gather(*(stock_sources(symbol) for symbol in symbols))
    sources = [record for group in grouped for record in group]
    if include_portfolio:
        if not isinstance(portfolios, list) or len(portfolios) > 10:
            raise ResearchDataError("Portfolio context is unavailable or exceeds supported scope.")
        for index, portfolio in enumerate(portfolios):
            try:
                snapshot = PortfolioResearchRequest.model_validate({
                    "currency": portfolio["base_currency"], "cash": portfolio["cash_balance"],
                    "positions": [{"symbol": position["symbol"], "quantity": position["quantity"],
                                   "average_cost": position["averageCost"], "current_price": position["lastPrice"]}
                                  for position in portfolio.get("positions", [])],
                })
                risk = research_portfolio(snapshot).model_dump(mode="json")
                sources.append(source(f"portfolio:{index}", "portfolio", f"Your paper portfolio {index + 1}", risk))
            except (ValidationError, ValueError, TypeError, KeyError):
                sources.append(source(f"portfolio:{index}", "portfolio", f"Your paper portfolio {index + 1}"))
                warnings.append("A portfolio has missing prices or unsupported amounts; valuation and risk metrics were not invented.")
        if not portfolios:
            sources.append(source("portfolio:empty", "portfolio", "Your paper portfolio", {"positions": [], "note": "No portfolio exists for this session."}))
        warnings.append("Portfolio context contains paper funds only. Concentration is not volatility, sector diversification, or a correlation-based risk estimate.")
    return symbols, sources, list(dict.fromkeys(warnings))
