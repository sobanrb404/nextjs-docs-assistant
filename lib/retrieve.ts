import type { RetrievedChunk } from "./groq";

const MATCH_COUNT = 5;

export async function retrieveRelevantChunks(question: string): Promise<RetrievedChunk[]> {
  const { embedBatchWithRetry } = await import("./gemini");
  const { supabase } = await import("./supabase");

  const [queryEmbedding] = await embedBatchWithRetry([question]);

  const { data, error } = await supabase.rpc("match_docs_chunks", {
    query_embedding: queryEmbedding,
    match_count: MATCH_COUNT,
  });

  if (error) throw new Error(`Supabase retrieval failed: ${error.message}`);

  return (data ?? []) as RetrievedChunk[];
}
