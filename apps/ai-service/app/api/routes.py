from fastapi import APIRouter, Request

from app.schemas.analysis import (
    AnalysisResponse, PortfolioResearch, PortfolioResearchRequest, SentimentAnalysis,
    SentimentRequest, StockResearch, StockResearchRequest, TechnicalAnalysis, TechnicalRequest,
)
from app.services.research import research_portfolio, research_stock
from app.services.sentiment import analyze_sentiment
from app.services.technical import analyze_technical
from app.services.technical_report import build_technical_report
from app.schemas.analysis import TechnicalReport
from app.utils.responses import response

router = APIRouter()


@router.get("/health", tags=["health"])
@router.get("/health/live", tags=["health"], include_in_schema=False)
@router.get("/health/ready", tags=["health"], include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok", "service": "asteriq-ai"}


@router.post("/analysis/technical", response_model=AnalysisResponse[TechnicalAnalysis], tags=["analysis"])
def technical(payload: TechnicalRequest, request: Request):
    return response(analyze_technical(payload), request)


@router.post("/analysis/sentiment", response_model=AnalysisResponse[SentimentAnalysis], tags=["analysis"])
def sentiment(payload: SentimentRequest, request: Request):
    return response(analyze_sentiment(payload), request)


@router.post("/research/stock", response_model=AnalysisResponse[StockResearch], tags=["research"])
def stock(payload: StockResearchRequest, request: Request):
    return response(research_stock(payload), request)


@router.post("/research/portfolio", response_model=AnalysisResponse[PortfolioResearch], tags=["research"])
def portfolio(payload: PortfolioResearchRequest, request: Request):
    return response(research_portfolio(payload), request)


@router.post("/analysis/technical/report", response_model=AnalysisResponse[TechnicalReport], tags=["analysis"])
def technical_report(payload: TechnicalRequest, request: Request):
    return response(build_technical_report(analyze_technical(payload)), request)
