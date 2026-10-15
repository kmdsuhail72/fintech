from contextlib import asynccontextmanager
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.security import HTTPAuthorizationCredentials

from app.api.assistant import authorization
from app.models.research_llm import OpenAIResearchProvider, ResearchProviderError
from app.schemas.analysis import AnalysisResponse
from app.schemas.assistant import AssistantResearch
from app.schemas.rag import DocumentIngestion, DocumentList, IngestionResult, RetrievalRequest, RetrievalResult, DeleteResult
from app.services.research_assistant import generate_document_research
from app.services.research_data import BackendReader, ResearchDataError
from app.services.rag import OpenAIEmbedder, RagService, RagError
from app.services.rag_store import PgVectorStore
from app.utils.responses import response

router = APIRouter(prefix="/research", tags=["Document RAG"])


def get_rag_service(request, embeddings=True):
    injected = getattr(request.app.state, "rag_service", None)
    if injected is not None:
        return injected
    config = request.app.state.rag_config
    try:
        return RagService(PgVectorStore(config.database_url), OpenAIEmbedder(config.api_key) if embeddings else None)
    except ImportError as error:
        raise RagError("Install requirements-rag.txt to enable document research.") from error


@asynccontextmanager
async def session(request, credentials):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to access research documents.")
    backend_url, _ = request.app.state.assistant_config
    try:
        async with httpx.AsyncClient(base_url=backend_url.rstrip("/") + "/", timeout=10,
                follow_redirects=False, transport=getattr(request.app.state, "research_backend_transport", None)) as client:
            reader = BackendReader(client, credentials.credentials)
            owner_id = UUID(str(await reader.authenticate()))
            # Documents and queries must not leak through implicit tracing.
            from langsmith import tracing_context
            with tracing_context(enabled=False):
                yield reader, owner_id
    except (ResearchDataError, ResearchProviderError, RagError) as error:
        raise HTTPException(status_code=error.status, detail=str(error)) from error
    except ImportError as error:
        raise HTTPException(status_code=503, detail="Install requirements-rag.txt to enable document research.") from error
    except Exception as error:
        raise HTTPException(status_code=503, detail="Document research is unavailable. Retry later.") from error


@router.post("/documents", response_model=AnalysisResponse[IngestionResult])
async def ingest(payload: DocumentIngestion, request: Request,
                 credentials: HTTPAuthorizationCredentials | None = Depends(authorization)):
    async with session(request, credentials) as (reader, owner_id):
        result = await get_rag_service(request).ingest(owner_id, payload)
        return response(result, request)


@router.get("/documents", response_model=AnalysisResponse[DocumentList])
async def documents(request: Request, limit: int = Query(default=50, ge=1, le=100),
                    offset: int = Query(default=0, ge=0, le=100000),
                    credentials: HTTPAuthorizationCredentials | None = Depends(authorization)):
    async with session(request, credentials) as (_, owner_id):
        records = await get_rag_service(request, embeddings=False).store.list(owner_id, limit, offset)
        return response(DocumentList(documents=records), request)


@router.delete("/documents/{document_id}", response_model=AnalysisResponse[DeleteResult])
async def delete(document_id: UUID, request: Request,
                 credentials: HTTPAuthorizationCredentials | None = Depends(authorization)):
    async with session(request, credentials) as (_, owner_id):
        await get_rag_service(request, embeddings=False).store.delete(owner_id, document_id)
        return response(DeleteResult(), request)


@router.post("/retrieve", response_model=AnalysisResponse[RetrievalResult])
async def retrieve(payload: RetrievalRequest, request: Request,
                   credentials: HTTPAuthorizationCredentials | None = Depends(authorization)):
    async with session(request, credentials) as (_, owner_id):
        return response(await get_rag_service(request).retrieve(owner_id, payload), request)


@router.post("/questions", response_model=AnalysisResponse[AssistantResearch])
async def answer(payload: RetrievalRequest, request: Request,
                 credentials: HTTPAuthorizationCredentials | None = Depends(authorization)):
    async with session(request, credentials) as (reader, _):
        provider = OpenAIResearchProvider(request.app.state.assistant_config[1])
        report = await generate_document_research(payload, reader, provider, get_rag_service(request))
        return response(report, request)
