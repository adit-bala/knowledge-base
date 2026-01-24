/**
 * Database schema and TypeScript types.
 */

/** SQL schema - executed on init */
export const SCHEMA = `
  -- Enable vector extension
  CREATE EXTENSION IF NOT EXISTS vector;

  -- Status enum
  DO $$ BEGIN
    CREATE TYPE article_status AS ENUM ('draft', 'published', 'archive', 'in_review');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;

  -- Articles table
  CREATE TABLE IF NOT EXISTS article (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    markdown TEXT NOT NULL,
    status article_status,
    last_edited TIMESTAMPTZ NOT NULL
  );

  -- Images table (BLOBs stored directly)
  CREATE TABLE IF NOT EXISTS image (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    data BYTEA NOT NULL,
    mime_type TEXT NOT NULL,
    original_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS image_article_idx ON image(article_id);

  -- Embeddings table with HNSW index
  CREATE TABLE IF NOT EXISTS embedding (
    id SERIAL PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    chunk_idx INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding vector(1536) NOT NULL
  );

  CREATE INDEX IF NOT EXISTS embedding_hnsw_idx 
    ON embedding USING hnsw (embedding vector_cosine_ops);

  CREATE INDEX IF NOT EXISTS embedding_fts_idx 
    ON embedding USING gin (to_tsvector('english', content));
`;

// TypeScript Types

export interface Article {
  id: string;
  title: string;
  description: string;
  tags: string[];
  created_at: Date;
  markdown: string;
  status: 'draft' | 'published' | 'archive' | 'in_review' | null;
  last_edited: Date;
}

export interface Image {
  id: string;
  article_id: string;
  data: Buffer;
  mime_type: string;
  original_url: string;
  created_at: Date;
}

export interface Embedding {
  id: number;
  article_id: string;
  chunk_idx: number;
  content: string;
  content_hash: string;
  embedding: number[];
}
