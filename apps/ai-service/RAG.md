# Document RAG for Asteriq AI

Documents → page extraction → LangChain chunking → OpenAI embeddings → pgvector → owner-scoped retriever → LangChain/OpenAI research → citations.

## Vector database recommendation

Use **pgvector** for this project. Asteriq already runs PostgreSQL; keeping document records, chunk metadata, ownership, and vectors together allows atomic ingestion and cascading deletion without a second managed service. [pgvector](https://github.com/pgvector/pgvector) supports cosine-distance search and both exact and approximate indexing. This implementation starts with exact search so tenant filtering happens before ranking. Benchmark your corpus before introducing HNSW; evaluate filtered-search recall, tenant partitioning, and iterative scans as it grows. Pinecone is an alternative when you want a separate managed vector service; OpenSearch is an alternative when search infrastructure is already central to your deployment. Neither is required here.

## Setup

1. Install `requirements.txt`, `requirements-assistant.txt`, and `requirements-rag.txt` in an isolated Python environment:

   ```powershell
   python -m pip install -r apps/ai-service/requirements.txt -r apps/ai-service/requirements-assistant.txt -r apps/ai-service/requirements-rag.txt
   ```

2. Configure server-only `OPENAI_API_KEY` and `RAG_DATABASE_URL`. Keep keys and database credentials out of Vite/mobile environment variables. Optional `OPENAI_RESEARCH_MODEL` controls answer generation. Embeddings use `text-embedding-3-small` with 1,536 dimensions; existing and query vectors must use the same model and dimensions. [OpenAI embedding documentation](https://developers.openai.com/api/docs/guides/embeddings) explains embedding models and dimensions.
3. Install pgvector on the PostgreSQL server, then apply numbered migrations in order through `007_research_documents.sql`. Docker Compose now uses `pgvector/pgvector:pg16` and supplies the internal RAG database URL. Migrations are **not** applied automatically:

   ```powershell
   psql "$env:RAG_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/007_research_documents.sql
   ```

   This assumes migrations 001–006 have already been applied. The migration role needs permission to create the `vector` extension. Keep existing PostgreSQL volumes on their current compatible major version; the Compose image remains PostgreSQL 16.

4. Run the backend, AI service, and web app. Sign in and open `/research`. Upload a report and select **Documents only** or **Market + documents**. Uploaded documents belong to the authenticated user; no owner ID can be supplied by the client.

## Ingestion and provenance

Supported sources include company reports, financial documents, earnings reports, market research, and investment education. The ingestion endpoint accepts TXT/Markdown text or base64 PDF bytes. PDFs must contain readable text; encrypted PDFs and scanned PDFs without OCR are rejected. Limits are 6 MB PDF bytes, 200 PDF pages, 400,000 extracted characters, and 500 chunks. TXT and Markdown use page number 1; PDFs preserve their physical 1-based page numbers, including intervening empty pages.

[LangChain's recursive text splitter](https://docs.langchain.com/oss/python/integrations/splitters/recursive_text_splitter) creates chunks of at most 1,200 characters with up to 200 characters of overlap, separately for each page. The retriever selects six chunks by default, with a maximum of twelve. Distances are cosine distances, not confidence estimates. No relevance cutoff is assumed; the model must explain when retrieved excerpts do not support the question.

Source metadata is carried from ingestion into chunks, retrieved evidence, and the final response:

- Immutable document ID and chunk ID; page number, chunk index, and start character offset within the extracted page.
- Title, publisher, document category, publication date, source URL, and ticker associations.
- Excerpt, ingestion timestamp, embedding model, pipeline version, and retrieval distance.

Metadata is supplied by the uploader and is not independently verified. Source URLs are citation links only; the service never fetches them. PDF text extraction may lose table layout or multi-column ordering; financial figures should be checked against the original report.

Identical content and metadata are deduplicated within each owner's corpus using a fingerprint that also includes the embedding model and pipeline version. Changed metadata or content creates a new immutable document version. Vectors and document records commit in one transaction; failed batches leave no partial document. Delete removes the owner's document and all its chunks. There is no shared/public corpus in this implementation.

## Authenticated APIs

Call these through `/api/v1/ai/research` with an Asteriq bearer session. The Python service exposes corresponding `/research` routes and independently verifies the session against the existing backend.

| Method | Path after prefix              | Purpose                                                                   |
| ------ | ------------------------------ | ------------------------------------------------------------------------- |
| POST   | `/documents`                   | Extract, chunk, embed, and atomically store a document                    |
| GET    | `/documents?limit=50&offset=0` | List the current user's documents                                         |
| DELETE | `/documents/{id}`              | Delete an owned document and chunks                                       |
| POST   | `/retrieve`                    | Return matching chunks and citation metadata without generating an answer |
| POST   | `/questions`                   | Answer from documents, using all seven research sections                  |
| POST   | `/assistant`                   | Existing market assistant; optionally include document evidence           |

Text ingestion body:

```json
{
  "format": "text",
  "content": "Revenue rose year over year; operating margins declined...",
  "metadata": {
    "title": "Example issuer Q2 earnings",
    "publisher": "Example issuer investor relations",
    "document_type": "earnings_report",
    "published_date": "2026-07-01",
    "source_url": "https://example.com/earnings",
    "symbols": ["NVDA"]
  }
}
```

Retrieval or document question body:

```json
{ "question": "How did revenue and margins change?", "document_ids": [], "top_k": 6 }
```

An empty `document_ids` list searches all documents owned by the session. Explicit IDs must all belong to that user; unknown and foreign IDs both return 404. Mixed market/document research uses the existing assistant body with `include_documents: true` and optional `document_ids`. Market symbol inference is still required for that mode; document-only questions don't require registered tickers.

The answer retains seven sections, `ai_generated: true`, `label: "AI-generated research"`, and a complete `sources` array. Each section's `source_ids` references stable IDs such as `document:<document UUID>:chunk:<chunk UUID>`. The service checks that citations reference available retrieved evidence and rejects common profit-certainty claims. The model is instructed to treat document excerpts as untrusted data, distinguish historical publication dates from current facts, explain conflicting sources, and disclose absent market/technical/news evidence. Citation validation does not independently verify every generated claim. No profits or investment returns are guaranteed.

## Privacy and operational scope

Document text is sent to OpenAI for embeddings, and retrieved excerpts are sent for answer generation. Identity and access tokens are not included in model context. Implicit LangSmith tracing is disabled for embeddings and answers. Database queries are parameterized and include a verified owner predicate on every operation; composite foreign keys prevent a chunk from belonging to a different owner than its parent document. Deploy the AI service on a private network with the API as the public entry point.

Ingestion is synchronous and bounded to two concurrent embedding/retrieval operations per service process. Gateway ingestion timeout is 180 seconds. Large-scale ingestion queues, OCR, automatic URL fetching, shared-corpus publishing, reranking, and scheduled report refresh are future extensions. Documents are not published or shared by ingestion.

## Validation

```powershell
python -m pytest apps/ai-service/tests -q -p no:cacheprovider
npm run test --workspace @asteriq/api
npm run build
```

RAG tests use real LangChain splitting and a mocked OpenAI transport. They cover offsets, metadata, duplicate ingestion, invalid vectors, citation checks, document endpoints, deletion, and owner isolation. Installing RAG dependencies enables these tests; otherwise dependency-specific cases are skipped.

To run the real PostgreSQL test, set **`RAG_TEST_DATABASE_URL` to a disposable pgvector-enabled test database**, then run `python -m pytest apps/ai-service/tests/test_rag_postgres.py -q`. The test creates and drops its own random schema, applies migration 007, verifies cosine ranking and ownership, and forces a failed batch to check transaction rollback. It may install the `vector` extension in the disposable database. No live OpenAI calls are made by these tests.
