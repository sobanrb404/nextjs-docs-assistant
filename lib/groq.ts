import Groq from "groq-sdk";

const MODEL = "openai/gpt-oss-120b";

let client: Groq | null = null;
function getClient(): Groq {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Missing GROQ_API_KEY in .env.local");
    client = new Groq({ apiKey });
  }
  return client;
}

export interface RetrievedChunk {
  content: string;
  url: string;
  heading: string;
}

const SYSTEM_PROMPT = `You are a support assistant for the Next.js documentation (App Router).
Answer the user's question using ONLY the documentation excerpts provided below — do not use outside knowledge.
If the excerpts don't contain enough information to answer, say so clearly instead of guessing.
Keep answers concise and practical. Reference specific excerpts when helpful (e.g. "According to the [heading] section...").`;

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => `[Excerpt ${i + 1} — "${c.heading}" (${c.url})]\n${c.content}`)
    .join("\n\n---\n\n");
}

export async function generateAnswer(
  question: string,
  chunks: RetrievedChunk[]
): Promise<string> {
  const context = buildContext(chunks);

  const completion = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Documentation excerpts:\n\n${context}\n\n---\n\nQuestion: ${question}`,
      },
    ],
    temperature: 0.2,
  });

  return completion.choices[0]?.message?.content ?? "";
}

// Async generator yielding answer text as it's generated, token by token.
export async function* streamAnswer(
  question: string,
  chunks: RetrievedChunk[]
): AsyncGenerator<string> {
  const context = buildContext(chunks);

  const stream = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Documentation excerpts:\n\n${context}\n\n---\n\nQuestion: ${question}`,
      },
    ],
    temperature: 0.2,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}
