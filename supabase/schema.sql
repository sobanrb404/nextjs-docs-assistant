-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- 1. Enable the pgvector extension
create extension if not exists vector;

-- 2. Table to store each doc chunk + its embedding
create table if not exists docs_chunks (
  id bigserial primary key,
  content text not null,
  url text not null,
  heading text,
  embedding vector(768),
  created_at timestamptz default now()
);

-- 3. Index for fast similarity search
create index if not exists docs_chunks_embedding_idx
  on docs_chunks
  using hnsw (embedding vector_cosine_ops);

-- 4. Function used at query time: given a question's embedding, return the closest chunks
create or replace function match_docs_chunks (
  query_embedding vector(768),
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  url text,
  heading text,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    url,
    heading,
    1 - (embedding <=> query_embedding) as similarity
  from docs_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;
