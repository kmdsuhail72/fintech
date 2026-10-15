"""Parameterized pgvector queries; every read and write is scoped to a verified owner."""
from contextlib import asynccontextmanager

from app.schemas.rag import DocumentRecord
from app.services.rag import EMBEDDING_MODEL, PIPELINE_VERSION, RagError


class PgVectorStore:
    def __init__(self, database_url):
        if not database_url or not database_url.get_secret_value():
            raise RagError("Configure RAG_DATABASE_URL and apply migration 007 to enable document retrieval.")
        self.database_url = database_url

    @asynccontextmanager
    async def connection(self):
        import psycopg
        from psycopg.rows import dict_row
        try:
            async with await psycopg.AsyncConnection.connect(self.database_url.get_secret_value(),
                    row_factory=dict_row, connect_timeout=5, options="-c statement_timeout=15000") as connection:
                yield connection
        except psycopg.Error as error:
            raise RagError("Document storage is unavailable. Check pgvector and migration 007.") from error

    @staticmethod
    def record(row):
        return DocumentRecord(**{key: row[key] for key in DocumentRecord.model_fields})

    async def find(self, owner_id, fingerprint):
        async with self.connection() as connection:
            cursor = await connection.execute("SELECT * FROM research_documents WHERE owner_id = %s AND fingerprint = %s", (owner_id, fingerprint))
            row = await cursor.fetchone()
            return self.record(row) if row else None

    async def save(self, owner_id, document_id, fingerprint, metadata, chunks):
        from psycopg.types.json import Jsonb
        async with self.connection() as connection:
            async with connection.transaction():
                cursor = await connection.execute("""INSERT INTO research_documents
                    (id, owner_id, fingerprint, metadata, embedding_model, pipeline_version, chunk_count)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (owner_id, fingerprint) DO NOTHING RETURNING *""",
                    (document_id, owner_id, fingerprint, Jsonb(metadata), EMBEDDING_MODEL, PIPELINE_VERSION, len(chunks)))
                row = await cursor.fetchone()
                created = row is not None
                if created:
                    async with connection.cursor() as cursor:
                        await cursor.executemany("""INSERT INTO research_document_chunks
                            (id, document_id, owner_id, chunk_index, page_number, start_index, content, embedding)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)""",
                            [(chunk_id, document_id, owner_id, index, page, start, text, vector)
                             for chunk_id, index, page, start, text, vector in chunks])
                else:
                    cursor = await connection.execute("SELECT * FROM research_documents WHERE owner_id = %s AND fingerprint = %s", (owner_id, fingerprint))
                    row = await cursor.fetchone()
                return self.record(row), created

    async def contains(self, owner_id, document_ids):
        async with self.connection() as connection:
            cursor = await connection.execute("SELECT count(*) AS count FROM research_documents WHERE owner_id = %s AND id = ANY(%s::uuid[])", (owner_id, document_ids))
            return (await cursor.fetchone())["count"] == len(set(document_ids))

    async def search(self, owner_id, vector, document_ids, top_k):
        async with self.connection() as connection:
            cursor = await connection.execute("""SELECT c.id, c.document_id, c.chunk_index,
                c.page_number, c.start_index, c.content, d.metadata, d.pipeline_version, d.created_at,
                c.embedding <=> %s::vector AS distance
                FROM research_document_chunks c
                JOIN research_documents d ON d.id = c.document_id AND d.owner_id = c.owner_id
                WHERE c.owner_id = %s AND d.embedding_model = %s
                  AND (cardinality(%s::uuid[]) = 0 OR d.id = ANY(%s::uuid[]))
                ORDER BY distance, c.id LIMIT %s""",
                (vector, owner_id, EMBEDDING_MODEL, document_ids, document_ids, top_k))
            return await cursor.fetchall()

    async def list(self, owner_id, limit=50, offset=0):
        async with self.connection() as connection:
            cursor = await connection.execute("SELECT * FROM research_documents WHERE owner_id = %s ORDER BY created_at DESC, id LIMIT %s OFFSET %s", (owner_id, limit, offset))
            return [self.record(row) for row in await cursor.fetchall()]

    async def delete(self, owner_id, document_id):
        async with self.connection() as connection:
            cursor = await connection.execute("DELETE FROM research_documents WHERE owner_id = %s AND id = %s RETURNING id", (owner_id, document_id))
            if not await cursor.fetchone():
                raise RagError("Document unavailable.", 404)
