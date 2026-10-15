from contextlib import asynccontextmanager
import logging
from app.observability import ObservabilityMiddleware, configure_logging
from app.tracing import configure_tracing, shutdown_tracing

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.responses import Response
from app.prometheus import registry, generate_latest, CONTENT_TYPE_LATEST
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import SecretStr
from starlette.exceptions import HTTPException

from app.api.routes import router
from app.api.ml import router as ml_router
from app.api.news import router as news_router
from app.api.assistant import router as assistant_router
from app.models.research_llm import ResearchProviderConfig
from app.models.financial_nlp import DEFAULT_MODEL, DEFAULT_REVISION, NewsModelConfig
from app.api.rag import router as rag_router
from app.services.rag import RagConfig


class Settings(BaseSettings):
    app_env: str = "development"
    ai_service_port: int = 8000
    log_level: str = "INFO"
    openai_api_key: SecretStr | None = None
    openai_research_model: str = "gpt-4.1-mini"
    research_assistant_enabled: bool = True
    research_backend_url: str = "http://127.0.0.1:3000/api/v1"
    rag_database_url: SecretStr | None = None
    news_sentiment_enabled: bool = True
    news_sentiment_model: str = DEFAULT_MODEL
    news_sentiment_revision: str = DEFAULT_REVISION
    news_sentiment_cache_dir: str = "artifacts/huggingface"
    news_sentiment_local_files_only: bool = True
    news_sentiment_batch_size: int = 8
    ml_model_path: str | None = None
    ml_model_sha256: str | None = None
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
configure_logging(settings.log_level.upper())
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("AI service starting in %s mode", settings.app_env)
    yield
    logger.info("AI service stopped")
    shutdown_tracing()


app = FastAPI(
    title="Asteriq AI Research Service", version="0.2.0",
    description="Educational research on caller-supplied data. Not investment advice.",
    lifespan=lifespan,
)


app.add_middleware(ObservabilityMiddleware)


@app.get('/metrics', include_in_schema=False)
async def metrics():
    return Response(content=generate_latest(registry), headers={'Content-Type': CONTENT_TYPE_LATEST})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    # Do not echo portfolio values, headlines, or submitted credentials into errors.
    return JSONResponse(status_code=422, content={
        "ok": False, "request_id": request.state.request_id,
        "error": {"code": "VALIDATION_ERROR", "message": "Request validation failed.",
                  "details": [{"path": list(item["loc"]), "code": item["type"]}
                              for item in error.errors()]},
    })


@app.exception_handler(HTTPException)
async def http_error(request: Request, error: HTTPException):
    return JSONResponse(status_code=error.status_code, headers=error.headers, content={
        "ok": False, "request_id": request.state.request_id,
        "error": {"code": "HTTP_ERROR", "message": str(error.detail)},
    })


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception):
    logger.error("Analysis failed type=%s", type(error).__name__,
                 extra={"requestId": request.state.request_id, "traceId": request.state.trace_id,
                        "status_code": 500, "event": 'database_failure' if type(error).__name__ in
                        {'OperationalError', 'DatabaseError', 'InterfaceError'} else 'ai_failure',
                        "endpoint": getattr(request.scope.get('route'), 'path', 'unmatched')})
    return JSONResponse(status_code=500, headers={"X-Request-Id": request.state.request_id,
                        "X-Trace-Id": request.state.trace_id}, content={
        "ok": False, "request_id": request.state.request_id,
        "error": {"code": "INTERNAL_ERROR", "message": "Unable to complete analysis."},
    })


app.include_router(router)

app.state.ml_model_config = (settings.ml_model_path, settings.ml_model_sha256)
app.include_router(ml_router)

app.state.news_model_config = NewsModelConfig(
    enabled=settings.news_sentiment_enabled, model_id=settings.news_sentiment_model,
    revision=settings.news_sentiment_revision, cache_dir=settings.news_sentiment_cache_dir,
    local_files_only=settings.news_sentiment_local_files_only,
    batch_size=settings.news_sentiment_batch_size,
)
app.include_router(news_router)

app.state.assistant_config = (settings.research_backend_url, ResearchProviderConfig(
    api_key=settings.openai_api_key, model=settings.openai_research_model,
    enabled=settings.research_assistant_enabled,
))
app.include_router(assistant_router)
app.state.rag_config = RagConfig(database_url=settings.rag_database_url, api_key=settings.openai_api_key)
app.include_router(rag_router)
configure_tracing(app)
