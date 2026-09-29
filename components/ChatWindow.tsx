"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SourcesPanel, { Source } from "./SourcesPanel";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

// The model occasionally emits literal <br> tags inside table cells; react-markdown
// doesn't render raw HTML by default, so replace them with a plain separator instead.
function stripHtmlBreaks(text: string): string {
  return text.replace(/<br\s*\/?>/gi, " ");
}

const EXAMPLE_QUESTIONS = [
  "How do I create a dynamic route?",
  "What's the difference between Server and Client Components?",
  "How do I fetch data in the App Router?",
];

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendQuestion(question: string) {
    if (!question.trim() || loading) return;

    setInput("");
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === "sources") {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], sources: event.sources };
              return next;
            });
          } else if (event.type === "token") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + event.text };
              return next;
            });
          } else if (event.type === "error") {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: `⚠️ ${event.message}`,
              };
              return next;
            });
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: "⚠️ Failed to reach the server. Please try again.",
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendQuestion(input);
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Next.js Docs Assistant
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ask questions about the Next.js App Router documentation
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {messages.length === 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Try asking:</p>
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendQuestion(q)}
                  className="w-fit rounded-lg border border-zinc-200 bg-white px-4 py-2 text-left text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end" : "self-start"}>
              <div
                className={`max-w-2xl rounded-2xl px-4 py-3 text-sm ${
                  m.role === "user"
                    ? "whitespace-pre-wrap bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-white text-zinc-800 border border-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-800"
                }`}
              >
                {m.content ? (
                  m.role === "assistant" ? (
                    <div className="markdown-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ children }) => (
                            <div className="my-2 overflow-x-auto">
                              <table className="w-full border-collapse text-xs">{children}</table>
                            </div>
                          ),
                          th: ({ children }) => (
                            <th className="border border-zinc-300 bg-zinc-100 px-2 py-1 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-800">
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700">
                              {children}
                            </td>
                          ),
                          code: ({ className, children, ...props }) => {
                            const isBlock = /language-/.test(className || "");
                            return isBlock ? (
                              <code
                                className="my-2 block overflow-x-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-800"
                                {...props}
                              >
                                {children}
                              </code>
                            ) : (
                              <code
                                className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800"
                                {...props}
                              >
                                {children}
                              </code>
                            );
                          },
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => (
                            <ul className="mb-2 list-disc pl-5">{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="mb-2 list-decimal pl-5">{children}</ol>
                          ),
                        }}
                      >
                        {stripHtmlBreaks(m.content)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    m.content
                  )
                ) : m.role === "assistant" && loading && i === messages.length - 1 ? (
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                  </span>
                ) : null}
              </div>
              {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                <SourcesPanel sources={m.sources} />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the Next.js App Router..."
            disabled={loading}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
