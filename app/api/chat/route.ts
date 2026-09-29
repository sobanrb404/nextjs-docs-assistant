import { NextRequest } from "next/server";
import { retrieveRelevantChunks } from "@/lib/retrieve";
import { streamAnswer } from "@/lib/groq";

function sseLine(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  let question: string;
  try {
    const body = await req.json();
    question = body.question;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  if (!question || typeof question !== "string" || !question.trim()) {
    return new Response(JSON.stringify({ error: "Missing 'question' field" }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const chunks = await retrieveRelevantChunks(question);
        controller.enqueue(
          encoder.encode(
            sseLine({
              type: "sources",
              sources: chunks.map((c) => ({ heading: c.heading, url: c.url })),
            })
          )
        );

        for await (const token of streamAnswer(question, chunks)) {
          controller.enqueue(encoder.encode(sseLine({ type: "token", text: token })));
        }

        controller.enqueue(encoder.encode(sseLine({ type: "done" })));
      } catch (err) {
        console.error("Chat API error:", err);
        controller.enqueue(
          encoder.encode(
            sseLine({ type: "error", message: "Something went wrong answering your question." })
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
