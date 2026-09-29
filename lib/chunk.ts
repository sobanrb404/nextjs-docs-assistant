export interface Chunk {
  heading: string;
  content: string;
}

const MIN_CHUNK_LENGTH = 40; // skip near-empty fragments (stray headings, etc.)
const MAX_CHUNK_LENGTH = 1200; // keep chunks small enough to be a focused retrieval unit

// Strips MDX frontmatter, import statements, and JSX components, leaving plain markdown text.
export function cleanMdx(raw: string): string {
  let text = raw.replace(/^---[\s\S]*?---\n/, ""); // frontmatter
  text = text.replace(/^import .*$/gm, ""); // import lines
  text = text.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""); // MDX comments {/* ... */}
  text = text.replace(/<[A-Z][^>]*\/>/g, ""); // self-closing JSX components e.g. <PagesOnly />
  text = text.replace(/<\/?[A-Z][a-zA-Z]*[^>]*>/g, ""); // opening/closing JSX component tags
  return text;
}

// Splits markdown into chunks along heading boundaries, then further splits
// any chunk that's still too long along paragraph boundaries.
export function chunkMarkdown(markdown: string, docTitle: string): Chunk[] {
  const lines = markdown.split("\n");
  const sections: { heading: string; body: string[] }[] = [
    { heading: docTitle, body: [] },
  ];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      sections.push({ heading: headingMatch[2].trim(), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = section.body.join("\n").trim();
    if (text.length < MIN_CHUNK_LENGTH) continue;

    if (text.length <= MAX_CHUNK_LENGTH) {
      chunks.push({ heading: section.heading, content: text });
      continue;
    }

    // Section too long: split further by paragraphs, grouping into ~MAX_CHUNK_LENGTH pieces
    const paragraphs = text.split(/\n\s*\n/);
    let buffer = "";
    for (const para of paragraphs) {
      if ((buffer + "\n\n" + para).length > MAX_CHUNK_LENGTH && buffer.length > 0) {
        chunks.push({ heading: section.heading, content: buffer.trim() });
        buffer = para;
      } else {
        buffer = buffer ? buffer + "\n\n" + para : para;
      }
    }
    if (buffer.trim().length >= MIN_CHUNK_LENGTH) {
      chunks.push({ heading: section.heading, content: buffer.trim() });
    }
  }

  return chunks;
}
