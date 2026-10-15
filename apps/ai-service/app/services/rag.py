"""Bounded ingestion and owner-scoped document retrieval with immutable citations."""
import asyncio
from contextlib import asynccontextmanager
import base64
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
import math
from uuid import UUID, uuid5, NAMESPACE_URL

from pydantic import SecretStr
from app.observability import observe_provider

from app.schemas.assistant import EvidenceSource
from app.schemas.rag import DocumentIngestion, IngestionResult, RetrievalResult

EMBEDDING_MODEL = "text-embedding-3-small"
DIMENSIONS = 1536
PIPELINE_VERSION = "recursive-chars-1200-overlap-200-v1"
MAX_TEXT = 400_000
MAX_CHUNKS = 500
WORK_LIMIT = asyncio.Semaphore(2)


class RagError(RuntimeError):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


@asynccontextmanager
async def admitted_work():
    # No await between capacity check and immediate semaphore acquisition.
    # This rejects overload instead of accumulating request bodies in a queue.
    if WORK_LIMIT.locked():
        raise RagError("Document processing is busy. Retry later.", 429)
    await WORK_LIMIT.acquire()
    try:
        yield
    finally:
        WORK_LIMIT.release()


@dataclass(frozen=True)
class RagConfig:
    database_url: SecretStr | None = None
    api_key: SecretStr | None = None


def extract_pages(payload: DocumentIngestion):
    if payload.format != "pdf":
        pages = [payload.content]
    else:
        try:
            from pypdf import PdfReader
            raw = base64.b64decode(payload.content, validate=True)
            if len(raw) > 6_000_000 or not raw.startswith(b"%PDF-"):
                raise ValueError("Unsupported PDF")
            reader = PdfReader(BytesIO(raw), strict=True)
            if reader.is_encrypted or len(reader.pages) > 200:
                raise ValueError("Unsupported PDF")
            pages = []
            total = 0
            for page in reader.pages:
                text = page.extract_text() or ""
                total += len(text)
                if total > MAX_TEXT:
                    raise ValueError("PDF text is too large")
                pages.append(text)
        except ImportError as error:
            raise RagError("Install requirements-rag.txt to process PDF documents.") from error
        except Exception as error:
            raise RagError("Provide a valid, unencrypted text PDF, at most 200 pages and 6 MB. Scanned PDFs require OCR before ingestion.", 422) from error
    if sum(map(len, pages)) > MAX_TEXT:
        raise RagError("Document exceeds 400,000 extracted characters. Split it into smaller documents.", 422)
    pages = [page.replace("\x00", "") for page in pages]
    if not any(page.strip() for page in pages):
        raise RagError("No readable text found. Scanned documents require OCR before ingestion.", 422)
    return pages


def chunk_pages(pages, metadata):
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=200,
                                              add_start_index=True)
    chunks = []
    for page_number, text in enumerate(pages, 1):
        for document in splitter.create_documents([text], [{**metadata, "page_number": page_number}]):
            if document.page_content.strip():
                document.metadata["chunk_index"] = len(chunks)
                chunks.append(document)
            if len(chunks) > MAX_CHUNKS:
                raise RagError("Document exceeds 500 chunks. Split it into smaller documents.", 422)
    return chunks


def vector_literal(vector):
    if len(vector) != DIMENSIONS or any(not math.isfinite(value) for value in vector) or not any(vector):
        raise RagError("Embedding provider returned an invalid vector.", 502)
    return "[" + ",".join(str(float(value)) for value in vector) + "]"


class OpenAIEmbedder:
    def __init__(self, api_key, model_factory=None):
        if not api_key or not api_key.get_secret_value():
            raise RagError("Configure a server-side OpenAI API key for document embeddings.")
        from langchain_openai import OpenAIEmbeddings
        factory = model_factory or OpenAIEmbeddings
        self.model = factory(model=EMBEDDING_MODEL, dimensions=DIMENSIONS,
            api_key=api_key.get_secret_value(), base_url="https://api.openai.com/v1",
            request_timeout=45, max_retries=0, chunk_size=32)

    @observe_provider
    async def documents(self, texts):
        from langsmith import tracing_context
        try:
            with tracing_context(enabled=False):
                return await self.model.aembed_documents(texts)
        except Exception as error:
            raise RagError("Document embeddings are unavailable. Retry later.") from error

    @observe_provider
    async def query(self, text):
        from langsmith import tracing_context
        try:
            with tracing_context(enabled=False):
                return await self.model.aembed_query(text)
        except Exception as error:
            raise RagError("Query embeddings are unavailable. Retry later.") from error


class RagService:
    def __init__(self, store, embedder, splitter=chunk_pages):
        self.store, self.embedder, self.splitter = store, embedder, splitter

    async def ingest(self, owner_id: UUID, payload: DocumentIngestion):
        async with admitted_work():
            pages = await asyncio.to_thread(extract_pages, payload)
            metadata = payload.metadata.model_dump(mode="json")
            fingerprint = sha256(json.dumps({"pages": pages, "metadata": metadata,
                "model": EMBEDDING_MODEL, "pipeline": PIPELINE_VERSION}, sort_keys=True).encode()).hexdigest()
            existing = await self.store.find(owner_id, fingerprint)
            if existing:
                return IngestionResult(document=existing, deduplicated=True)
            chunks = await asyncio.to_thread(self.splitter, pages, metadata)
            if not chunks:
                raise RagError("No readable chunks found.", 422)
            if len(chunks) > MAX_CHUNKS:
                raise RagError("Too many document chunks.", 422)
            document_id = uuid5(NAMESPACE_URL, str(owner_id) + ":" + fingerprint)
            vectors = await self.embedder.documents([chunk.page_content for chunk in chunks])
            if len(vectors) != len(chunks):
                raise RagError("Embedding provider returned an incomplete batch.", 502)
            rows = []
            for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
                rows.append((uuid5(document_id, str(index)), index, chunk.metadata["page_number"],
                             chunk.metadata["start_index"], chunk.page_content, vector_literal(vector)))
            record, created = await self.store.save(owner_id, document_id, fingerprint, metadata, rows)
            return IngestionResult(document=record, deduplicated=not created)

    async def retrieve(self, owner_id, payload):
        async with admitted_work():
            # Check selected IDs before embedding; don't reveal foreign document existence.
            if payload.document_ids and not await self.store.contains(owner_id, payload.document_ids):
                raise RagError("One or more selected documents are unavailable.", 404)
            vector = vector_literal(await self.embedder.query(payload.question))
            rows = await self.store.search(owner_id, vector, payload.document_ids, payload.top_k)
            sources = []
            for row in rows:
                metadata = row["metadata"]
                sources.append(EvidenceSource(id=f"document:{row['document_id']}:chunk:{row['id']}",
                    kind="document", title=f"{metadata['title']} · page {row['page_number']}",
                    available=True, as_of=metadata.get("published_date"), url=metadata.get("source_url"),
                    data={**metadata, "document_id": str(row["document_id"]), "chunk_id": str(row["id"]),
                          "chunk_index": row["chunk_index"], "page_number": row["page_number"],
                          "start_index": row["start_index"], "excerpt": row["content"],
                          "cosine_distance": row["distance"], "embedding_model": EMBEDDING_MODEL,
                          "pipeline_version": row["pipeline_version"],
                          "ingested_at": row["created_at"].isoformat()}))
            warnings = ["Uploaded document metadata is supplied by the uploader, not independently verified. Documents may be outdated or conflict with current market evidence.",
                        "Retrieval ranks textual similarity; it does not establish factual accuracy, investment relevance, or causation."]
            if not sources:
                warnings.append("No document evidence was retrieved. Ingest documents or choose a different scope.")
            return RetrievalResult(sources=sources, embedding_model=EMBEDDING_MODEL, warnings=warnings)
