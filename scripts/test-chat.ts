// Quick manual test of the retrieval + generation pipeline, without starting the dev server.
// Run with: npx tsx scripts/test-chat.ts "your question here"

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const question = process.argv[2] || "How do I create a dynamic route in the app router?";

  const { retrieveRelevantChunks } = await import("../lib/retrieve");
  const { generateAnswer } = await import("../lib/groq");

  console.log("Question:", question);
  console.log("\nRetrieving relevant chunks...");
  const chunks = await retrieveRelevantChunks(question);

  console.log(`Found ${chunks.length} matches:`);
  chunks.forEach((c, i) => console.log(`  ${i + 1}. "${c.heading}" — ${c.url}`));

  console.log("\nGenerating answer...\n");
  const answer = await generateAnswer(question, chunks);

  console.log("=== ANSWER ===");
  console.log(answer);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
