from datetime import datetime, timezone
import json
import re
from threading import BoundedSemaphore

from app.models.research_llm import PROMPT_VERSION, ResearchProviderError
from app.schemas.analysis import DISCLAIMER
from app.schemas.assistant import AssistantResearch, ResearchDraft, SECTION_TITLES
from app.services.research_data import collect_evidence

ADMISSION = BoundedSemaphore(2)
EDUCATIONAL_NOTICE = (
    "AI-generated research may be incomplete or inaccurate. " + DISCLAIMER +
    " No profits or investment returns are guaranteed."
)


def validate_draft(draft: ResearchDraft, sources):
    available = {record.id for record in sources if record.available}
    for name in SECTION_TITLES:
        section = getattr(draft, name)
        if not section.content.strip() or len(section.content) > 3000 or len(section.source_ids) > 20:
            raise ResearchProviderError("Generated research failed response checks.", 502)
        if any(reference not in available for reference in section.source_ids):
            raise ResearchProviderError("Generated research cited an unavailable or unknown source.", 502)
        content = section.content.lower()
        if (re.search(r"\b(?:guarantee(?:d|s)?|risk[- ]free|assured|certain)\b.{0,50}\b(?:profits?|returns?|gains?)\b", content)
                or re.search(r"\b(?:profits?|returns?)\b.{0,30}\bguaranteed\b", content)
                or re.search(r"\b(?:cannot lose|never lose|always (?:rise|increase|profit)|100% profitable)\b", content)):
            raise ResearchProviderError("Generated research contains unsupported performance certainty.", 502)
    if sources and not any(getattr(draft, name).source_ids for name in SECTION_TITLES):
        raise ResearchProviderError("Generated research did not cite its retrieved evidence.", 502)


async def generate_research(payload, reader, provider, news_config, rag_service=None):
    owner_id = await reader.authenticate()
    provider.ensure_configured()
    if not ADMISSION.acquire(blocking=False):
        raise ResearchProviderError("AI research capacity is busy. Retry later.")
    try:
        symbols, sources, warnings = await collect_evidence(payload, reader, news_config)
        if payload.include_documents or payload.document_ids:
            from uuid import UUID
            from app.schemas.rag import RetrievalRequest
            from app.services.rag import RagError
            if rag_service is None:
                raise RagError("Document retrieval is not configured.")
            retrieved = await rag_service.retrieve(UUID(str(owner_id)), RetrievalRequest(
                question=payload.question, document_ids=payload.document_ids))
            sources.extend(retrieved.sources)
            warnings.extend(retrieved.warnings)
        evidence = {"symbols": symbols, "requested_interval": payload.interval,
                    "sources": [record.model_dump(mode="json") for record in sources],
                    "data_quality": warnings}
        if len(json.dumps(evidence, allow_nan=False)) > 90000:
            raise ResearchProviderError("Research context exceeds the supported size. Narrow the request.", 422)
        # Catch revocation/expiry after retrieval and before sending private context to OpenAI.
        await reader.authenticate()
        draft = await provider.generate(payload.question, evidence)
        validate_draft(draft, sources)
        draft.educational_conclusion.content += " " + EDUCATIONAL_NOTICE
        return AssistantResearch(
            **draft.model_dump(), question=payload.question, symbols=symbols,
            generated_at=datetime.now(timezone.utc), model=provider.config.model,
            prompt_version=PROMPT_VERSION, sources=sources, data_quality=warnings,
            disclaimer=EDUCATIONAL_NOTICE,
        )
    finally:
        ADMISSION.release()


async def generate_document_research(payload, reader, provider, rag_service):
    from uuid import UUID
    owner_id = UUID(str(await reader.authenticate()))
    provider.ensure_configured()
    if not ADMISSION.acquire(blocking=False):
        raise ResearchProviderError("AI research capacity is busy. Retry later.")
    try:
        retrieved = await rag_service.retrieve(owner_id, payload)
        await reader.authenticate()
        draft = await provider.generate(payload.question, {
            "scope": "document-only", "sources": [source.model_dump(mode="json") for source in retrieved.sources],
            "data_quality": retrieved.warnings,
        })
        validate_draft(draft, retrieved.sources)
        draft.educational_conclusion.content += " " + EDUCATIONAL_NOTICE
        return AssistantResearch(**draft.model_dump(), question=payload.question, symbols=[],
            generated_at=datetime.now(timezone.utc), model=provider.config.model,
            prompt_version=PROMPT_VERSION, sources=retrieved.sources,
            data_quality=retrieved.warnings, disclaimer=EDUCATIONAL_NOTICE)
    finally:
        ADMISSION.release()
