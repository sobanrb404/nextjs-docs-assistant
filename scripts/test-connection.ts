// One-off check: confirms .env.local is loaded correctly and the
// docs_chunks table + match_docs_chunks function exist in Supabase.
// Run with: npx tsx scripts/test-connection.ts

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { supabase } = await import("../lib/supabase");

  const { error: tableError, count } = await supabase
    .from("docs_chunks")
    .select("*", { count: "exact", head: true });

  if (tableError) {
    console.error("❌ Could not read docs_chunks table:", tableError.message);
    console.error("   Did you run supabase/schema.sql in the Supabase SQL Editor?");
    process.exit(1);
  }

  console.log(`✅ docs_chunks table exists (${count ?? 0} rows so far)`);

  const { error: fnError } = await supabase.rpc("match_docs_chunks", {
    query_embedding: Array(768).fill(0),
    match_count: 1,
  });

  if (fnError) {
    console.error("❌ match_docs_chunks function not working:", fnError.message);
    process.exit(1);
  }

  console.log("✅ match_docs_chunks function works");
  console.log("\nPhase 1 database setup confirmed working.");
}

main();
