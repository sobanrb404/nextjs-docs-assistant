const EMBED_DIM = 768;
const MODEL = "gemini-embedding-001";

// Embeds up to 100 texts in a single API call (Gemini's batch limit).
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in .env.local");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBED_DIM,
        })),
      }),
    });
  } catch {
    // Network-level failure (DNS blip, connection reset, timeout) — treat as retryable.
    throw new Error("TRANSIENT_NETWORK_ERROR");
  }

  if (res.status === 429) {
    throw new Error("RATE_LIMITED");
  }

  if (res.status >= 500) {
    throw new Error("TRANSIENT_SERVER_ERROR");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini embedding request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.embeddings.map((e: { values: number[] }) => e.values);
}

const RETRYABLE = new Set(["RATE_LIMITED", "TRANSIENT_NETWORK_ERROR", "TRANSIENT_SERVER_ERROR"]);

// Wraps embedBatch with a patient retry on rate limiting or transient network/server errors.
// Free tier per-minute limits mean a 429 often needs a real minute to clear, not a few seconds.
export async function embedBatchWithRetry(
  texts: string[],
  retries = 8
): Promise<number[][]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await embedBatch(texts);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      if (!RETRYABLE.has(reason) || attempt === retries) throw err;
      const waitMs = Math.min(15000 * (attempt + 1), 90000); // 15s, 30s, 45s ... capped at 90s
      console.log(`   ${reason}, waiting ${waitMs / 1000}s before retry...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("unreachable");
}
