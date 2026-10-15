"""Opt-in tests against a disposable pgvector PostgreSQL database, never production."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import os
from uuid import uuid4

import pytest
from pydantic import SecretStr

from app.schemas.rag import DocumentIngestion, DocumentMetadata, RetrievalRequest
from app.services.rag import RagService, RagError, DIMENSIONS
from app.services.rag_store import PgVectorStore

pytestmark = pytest.mark.skipif(not os.environ.get("RAG_TEST_DATABASE_URL"), reason="Set RAG_TEST_DATABASE_URL to a disposable pgvector database")


def test_pgvector_migration_atomic_ingestion_cosine_ranking_and_owner_isolation():
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row

    async def scenario():
        url = os.environ["RAG_TEST_DATABASE_URL"]
        schema = "rag_test_" + uuid4().hex
        async with await psycopg.AsyncConnection.connect(url, autocommit=True) as admin:
            await admin.execute("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public")
            await admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            try:
                await admin.execute(sql.SQL("SET search_path TO {}, public").format(sql.Identifier(schema)))
                await admin.execute("CREATE TABLE users (id uuid PRIMARY KEY)")
                migration = Path(__file__).resolve().parents[3] / "database/migrations/007_research_documents.sql"
                await admin.execute(migration.read_text())
                owner, stranger = uuid4(), uuid4()
                await admin.execute("INSERT INTO users VALUES (%s), (%s)", (owner, stranger))

                class Store(PgVectorStore):
                    @asynccontextmanager
                    async def connection(self):
                        async with await psycopg.AsyncConnection.connect(url, row_factory=dict_row) as connection:
                            await connection.execute(sql.SQL("SET search_path TO {}, public").format(sql.Identifier(schema)))
                            yield connection

                class Embedder:
                    async def documents(self, texts):
                        return [([1.0, 0.0] if "revenue" in text else [0.0, 1.0]) + [0.0] * (DIMENSIONS - 2) for text in texts]
                    async def query(self, text):
                        return [1.0, 0.0] + [0.0] * (DIMENSIONS - 2)

                service = RagService(Store(SecretStr(url)), Embedder())
                metadata = DocumentMetadata(title="Earnings", publisher="Issuer", document_type="earnings_report")
                first = await service.ingest(owner, DocumentIngestion(metadata=metadata, content="revenue grew"))
                await service.ingest(owner, DocumentIngestion(metadata=metadata, content="margins fell"))
                assert (await service.ingest(owner, DocumentIngestion(metadata=metadata, content="revenue grew"))).deduplicated
                result = await service.retrieve(owner, RetrievalRequest(question="Revenue?", top_k=2))
                assert result.sources[0].data["excerpt"] == "revenue grew"
                assert result.sources[0].data["cosine_distance"] == pytest.approx(0)
                assert not (await service.retrieve(stranger, RetrievalRequest(question="Revenue?"))).sources
                with pytest.raises(RagError):
                    await service.retrieve(stranger, RetrievalRequest(question="Revenue?", document_ids=[first.document.id]))
                with pytest.raises(RagError):
                    await service.store.delete(stranger, first.document.id)
                # A bad second chunk must roll back both parent and first chunk.
                failed_id = uuid4()
                with pytest.raises(Exception):
                    await service.store.save(owner, failed_id, "failed-batch", metadata.model_dump(mode="json"), [
                        (uuid4(), 0, 1, 0, "valid", "[" + ",".join(["1"] * DIMENSIONS) + "]"),
                        (uuid4(), 1, 1, 0, "invalid", "[1]")])
                assert await service.store.find(owner, "failed-batch") is None
                await service.store.delete(owner, first.document.id)
                assert not await service.store.contains(owner, [first.document.id])
            finally:
                await admin.execute(sql.SQL("SET search_path TO public"))
                await admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
    asyncio.run(scenario())
