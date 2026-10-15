from fastapi import APIRouter, HTTPException, Request, Response
from app.prometheus import inference

from app.models.financial_nlp import CONFIDENCE_METHOD, NewsInputTooLong, NewsModelUnavailable
from app.schemas.news import BatchSentiment, NewsArticle, NewsBatch, NewsSentiment
from app.services.news_sentiment import analyze_news_batch

router = APIRouter(prefix="/news/sentiment", tags=["financial news sentiment"])


def process(articles: list[NewsArticle], request: Request, http_response: Response) -> BatchSentiment:
    config = request.app.state.news_model_config
    try:
        with inference('news_sentiment'):
            result = analyze_news_batch(articles, config)
    except NewsInputTooLong as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except NewsModelUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error), headers={"Retry-After": "30"}) from error
    http_response.headers["X-Sentiment-Model"] = config.model_id
    http_response.headers["X-Sentiment-Revision"] = config.revision
    http_response.headers["X-Confidence-Method"] = CONFIDENCE_METHOD
    return result


@router.post("", response_model=NewsSentiment)
def single(payload: NewsArticle, request: Request, response: Response):
    return process([payload], request, response).results[0]


@router.post("/batch", response_model=BatchSentiment)
def batch(payload: NewsBatch, request: Request, response: Response):
    return process(payload.articles, request, response)
