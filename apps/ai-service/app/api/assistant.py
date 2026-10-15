import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.models.research_llm import OpenAIResearchProvider, ResearchProviderError
from app.schemas.analysis import AnalysisResponse
from app.schemas.assistant import AssistantRequest, AssistantResearch
from app.services.research_assistant import generate_research
from app.services.research_data import BackendReader, ResearchDataError
from app.utils.responses import response
from app.services.rag import RagError

router = APIRouter(tags=["AI-generated research"])
authorization = HTTPBearer(auto_error=False)


@router.post("/research/assistant", response_model=AnalysisResponse[AssistantResearch])
async def assistant(payload: AssistantRequest, request: Request,
                    credentials: HTTPAuthorizationCredentials | None = Depends(authorization)):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to request research.")
    backend_url, provider_config = request.app.state.assistant_config
    provider = OpenAIResearchProvider(provider_config)
    try:
        async with httpx.AsyncClient(base_url=backend_url.rstrip("/") + "/", timeout=10,
                follow_redirects=False, transport=getattr(request.app.state, "research_backend_transport", None)) as client:
            reader = BackendReader(client, credentials.credentials)
            rag_service = None
            if payload.include_documents or payload.document_ids:
                from app.api.rag import get_rag_service
                # Validate session before creating any document providers.
                await reader.authenticate()
                rag_service = get_rag_service(request)
            result = await generate_research(payload, reader, provider, request.app.state.news_model_config, rag_service)
        return response(result, request)
    except (ResearchDataError, ResearchProviderError, RagError) as error:
        headers = {"Retry-After": "30"} if error.status == 503 else None
        raise HTTPException(status_code=error.status, detail=str(error), headers=headers) from error
