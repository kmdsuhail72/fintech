BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE research_documents (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  metadata jsonb NOT NULL,
  embedding_model text NOT NULL CHECK (embedding_model = 'text-embedding-3-small'),
  pipeline_version text NOT NULL,
  chunk_count integer NOT NULL CHECK (chunk_count BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, fingerprint),
  UNIQUE (id, owner_id)
);
CREATE TABLE research_document_chunks (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  page_number integer NOT NULL CHECK (page_number > 0),
  start_index integer NOT NULL CHECK (start_index >= 0),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 1200),
  embedding vector(1536) NOT NULL,
  FOREIGN KEY (document_id, owner_id) REFERENCES research_documents(id, owner_id) ON DELETE CASCADE,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX research_documents_owner_idx ON research_documents(owner_id, created_at DESC);
CREATE INDEX research_chunks_owner_document_idx ON research_document_chunks(owner_id, document_id);
-- Exact cosine search is deliberate: ownership filters apply before ranking.
-- Evaluate tenant-partitioned HNSW/iterative scans before scaling to large corpora.
COMMIT;
