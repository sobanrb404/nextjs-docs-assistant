// One-time ingestion: pulls Next.js App Router docs from GitHub, chunks them,
// embeds each chunk via Gemini, and stores everything in Supabase.
//
// Usage:
//   npx tsx scripts/ingest.ts            -> ingest everything (~291 files)
//   npx tsx scripts/ingest.ts --limit 10 -> ingest only the first 10 files (quick test run)

import { config } from "dotenv";
config({ path: ".env.local" });

const REPO = "vercel/next.js";
const BRANCH = "canary";
const DOCS_PREFIX = "docs/01-app/";
const BATCH_SIZE = 10; // chunks per embedding API call (smaller batches = less wasted work on a rate-limit retry)
const BATCH_DELAY_MS = 20000; // pause between batches — free tier's real per-minute limit is tighter than it first looked

interface DocFile {
  path: string;
  title: string;
  url: string;
}

// Local cache so a flaky connection doesn't force us to re-download the same
// ~16MB file listing and hundreds of doc pages on every retry. Gitignored.
const CACHE_DIR = new URL("../.ingest-cache/", import.meta.url);
const TREE_CACHE_FILE = new URL("tree.json", CACHE_DIR);

// Fetches JSON with retries covering the *entire* request including body streaming —
// a flaky connection can drop mid-body after headers already came back 200 OK,
// which a retry that only wraps the initial fetch() call would miss.
async function fetchJsonWithRetry(url: string, retries = 5): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      const waitMs = 3000 * (attempt + 1);
      console.log(`   network hiccup fetching ${url} (${(err as Error).message}), retrying in ${waitMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("unreachable");
}

async function fetchWithRetry(url: string, retries = 5): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const waitMs = 3000 * (attempt + 1);
      console.log(`   network hiccup fetching ${url}, retrying in ${waitMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("unreachable");
}

// Fetches only the docs/01-app subtree (a few hundred KB) instead of the entire
// repo tree (~16MB including all of Next.js's source code) — much lighter to
// download reliably over a shaky connection.
async function listDocFiles(): Promise<DocFile[]> {
  const fs = await import("fs/promises");
  await fs.mkdir(CACHE_DIR, { recursive: true });

  let relativePaths: string[];
  try {
    relativePaths = JSON.parse(await fs.readFile(TREE_CACHE_FILE, "utf-8"));
    console.log("Using cached file list (delete .ingest-cache/ to force a refresh).");
  } catch {
    const rootTree = await fetchJsonWithRetry(
      `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}`
    );
    const docsEntry = rootTree.tree.find((t: { path: string }) => t.path === "docs");
    if (!docsEntry) throw new Error("Could not find docs/ folder in repo tree");

    const docsTree = await fetchJsonWithRetry(
      `https://api.github.com/repos/${REPO}/git/trees/${docsEntry.sha}`
    );
    const appEntry = docsTree.tree.find((t: { path: string }) => t.path === "01-app");
    if (!appEntry) throw new Error("Could not find docs/01-app folder in repo tree");

    const appTree = await fetchJsonWithRetry(
      `https://api.github.com/repos/${REPO}/git/trees/${appEntry.sha}?recursive=1`
    );
    relativePaths = appTree.tree
      .filter((t: { path: string; type: string }) => t.type === "blob" && t.path.endsWith(".mdx"))
      .map((t: { path: string }) => t.path);

    await fs.writeFile(TREE_CACHE_FILE, JSON.stringify(relativePaths));
  }

  return relativePaths.map((relPath) => {
    const fullPath = DOCS_PREFIX + relPath;
    const slug = relPath
      .replace(/\.mdx$/, "")
      .replace(/\/index$/, "")
      .split("/")
      .map((seg) => seg.replace(/^\d+-/, "")) // strip ordering prefixes like "01-"
      .join("/");
    const title = slug.split("/").pop() || slug;
    return {
      path: fullPath,
      title,
      url: `https://nextjs.org/docs/app/${slug}`,
    };
  });
}

async function fetchRaw(path: string): Promise<string> {
  const fs = await import("fs/promises");
  const cacheFile = new URL(`raw-${path.replace(/\//g, "_")}`, CACHE_DIR);

  try {
    return await fs.readFile(cacheFile, "utf-8");
  } catch {
    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
    let text = "";
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await fetchWithRetry(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    await fs.writeFile(cacheFile, text);
    return text;
  }
}

async function main() {
  const { cleanMdx, chunkMarkdown } = await import("../lib/chunk");
  const { embedBatchWithRetry } = await import("../lib/gemini");
  const { supabase } = await import("../lib/supabase");

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;

  console.log("Fetching file list from GitHub...");
  let files = await listDocFiles();
  if (limit) files = files.slice(0, limit);
  console.log(`Found ${files.length} doc files to ingest.\n`);

  type PendingRow = { content: string; url: string; heading: string };
  let allChunks: PendingRow[] = [];

  for (const [i, file] of files.entries()) {
    process.stdout.write(`[${i + 1}/${files.length}] ${file.path} ... `);
    try {
      const raw = await fetchRaw(file.path);
      const cleaned = cleanMdx(raw);
      const chunks = chunkMarkdown(cleaned, file.title);
      for (const c of chunks) {
        allChunks.push({ content: c.content, url: file.url, heading: c.heading });
      }
      console.log(`${chunks.length} chunks`);
    } catch (err) {
      console.log(`SKIPPED (${(err as Error).message})`);
    }
  }

  // Resume support: if some chunks were already inserted by a previous (interrupted) run,
  // skip that many — file order from GitHub is stable, so this lines back up correctly
  // as long as you don't pass a different --limit than before.
  const { count: alreadyInserted } = await supabase
    .from("docs_chunks")
    .select("*", { count: "exact", head: true });
  const startAt = alreadyInserted ?? 0;
  if (startAt > 0) {
    console.log(`Resuming: ${startAt} chunks already in Supabase, skipping those.\n`);
  }

  console.log(`Total chunks to embed: ${allChunks.length}`);
  console.log("Embedding + inserting in batches...\n");

  let inserted = startAt;
  for (let i = startAt; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);

    let embeddings: number[][];
    try {
      embeddings = await embedBatchWithRetry(batch.map((c) => c.content));
    } catch (err) {
      console.error(
        `\nGiving up at chunk ${i}/${allChunks.length} after repeated rate limiting: ${(err as Error).message}`
      );
      console.error(`Re-run the same command later — it will resume from chunk ${i}.`);
      process.exit(1);
    }

    const rows = batch.map((c, idx) => ({
      content: c.content,
      url: c.url,
      heading: c.heading,
      embedding: embeddings[idx],
    }));

    const { error } = await supabase.from("docs_chunks").insert(rows);
    if (error) {
      console.error(`Insert failed at chunk ${i}:`, error.message);
      continue;
    }

    inserted += rows.length;
    console.log(`  inserted ${inserted}/${allChunks.length} chunks`);

    if (i + BATCH_SIZE < allChunks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\nDone. ${inserted} chunks stored in Supabase.`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
