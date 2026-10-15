import numpy as np

from app.schemas.analysis import (
    Allocation, PortfolioResearch, PortfolioResearchRequest, SentimentRequest,
    StockResearch, StockResearchRequest,
)
from app.services.sentiment import analyze_sentiment
from app.services.technical import analyze_technical


def research_stock(request: StockResearchRequest) -> StockResearch:
    technical = analyze_technical(request)
    sentiment = analyze_sentiment(SentimentRequest(texts=request.headlines)) if request.headlines else None
    summary = list(technical.observations_summary)
    if sentiment:
        summary.append(f"Supplied headlines have {sentiment.label} lexical sentiment.")
    return StockResearch(
        symbol=request.symbol, company_name=request.company_name, technical=technical,
        sentiment=sentiment, summary=summary,
        research_questions=[
            "How do earnings, cash flow, and valuation compare with sector peers?",
            "Are recent price changes supported by verified news and fundamentals?",
            "Which liquidity, concentration, and downside risks warrant further research?",
        ], limitations=[
            "No external data was fetched; company fundamentals and headline claims are not verified.",
            "This report combines descriptive indicators and optional lexical sentiment, not personalized recommendations.",
        ],
    )


def research_portfolio(request: PortfolioResearchRequest) -> PortfolioResearch:
    values = np.array([p.quantity * p.current_price for p in request.positions], dtype=float)
    costs = np.array([p.quantity * p.average_cost for p in request.positions], dtype=float)
    holdings, basis = float(values.sum()), float(costs.sum())
    total = holdings + request.cash
    allocations = [
        Allocation(symbol=p.symbol, market_value=float(value), cost_basis=float(cost),
                   unrealized_pnl=float(value - cost),
                   unrealized_pnl_percent=float((value / cost - 1) * 100),
                   portfolio_weight_percent=float(value / total * 100))
        for p, value, cost in zip(request.positions, values, costs)
    ]
    largest = max((item.portfolio_weight_percent for item in allocations), default=0.0) if total else None
    observations = [f"Portfolio includes {len(allocations)} supplied positions."]
    if largest is not None and largest > 25:
        observations.append("One position exceeds 25% of supplied total value; review concentration exposure.")
    if not allocations:
        observations.append("No invested positions were supplied; historical risk cannot be assessed.")
    return PortfolioResearch(
        currency=request.currency, cash=request.cash, holdings_value=holdings, total_value=total,
        cost_basis=basis, unrealized_pnl=holdings - basis,
        unrealized_pnl_percent=(holdings / basis - 1) * 100 if basis else None,
        cash_weight_percent=request.cash / total * 100 if total else None,
        largest_position_weight_percent=largest,
        holdings_concentration_hhi=float(np.square(values / holdings).sum()) if holdings else None,
        allocations=allocations, observations=observations,
        limitations=[
            "All amounts must already share the stated currency; currency conversion is not performed.",
            "Caller-supplied prices and cost bases are not independently verified; totals are approximate analytics, not ledger accounting.",
            "HHI measures holdings weight concentration from 0 to 1 and excludes cash; it does not measure market risk.",
            "No returns history, correlations, sector classification, fees, realized P/L, or taxes are supplied; risk-adjusted performance cannot be estimated.",
        ],
    )
