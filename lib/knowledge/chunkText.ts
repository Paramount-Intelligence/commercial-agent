/**
 * Chunk admin knowledge text for ContentChunk embedding.
 * Prefer natural paragraph breaks; fall back to size-based splits.
 */
const TARGET_CHARS = 1_100;
const MAX_CHARS = 1_600;
const MIN_CHARS = 40;

export type TextChunk = {
  heading: string;
  content: string;
};

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitOversized(block: string): string[] {
  if (block.length <= MAX_CHARS) return [block];
  const parts: string[] = [];
  let remaining = block;
  while (remaining.length > MAX_CHARS) {
    let cut = remaining.lastIndexOf(' ', TARGET_CHARS);
    if (cut < TARGET_CHARS * 0.5) cut = TARGET_CHARS;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

/**
 * Build embeddable chunks from a title + freeform body (and/or extracted file text).
 */
export function chunkKnowledgeText(opts: {
  title: string;
  body?: string | null;
  fileText?: string | null;
  fileLabel?: string | null;
}): TextChunk[] {
  const chunks: TextChunk[] = [];
  const title = opts.title.trim() || 'Untitled knowledge';

  const pushBlocks = (heading: string, raw: string) => {
    const text = normalizeText(raw);
    if (text.length < MIN_CHARS) return;

    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    let buffer = '';
    let part = 1;
    const flush = () => {
      const content = buffer.trim();
      buffer = '';
      if (content.length < MIN_CHARS) return;
      for (const piece of splitOversized(content)) {
        const label =
          paragraphs.length <= 1 && part === 1
            ? heading
            : `${heading} (${part})`;
        chunks.push({ heading: label, content: piece });
        part += 1;
      }
    };

    for (const para of paragraphs.length ? paragraphs : [text]) {
      if (!buffer) {
        buffer = para;
        continue;
      }
      if (buffer.length + para.length + 2 <= TARGET_CHARS) {
        buffer = `${buffer}\n\n${para}`;
      } else {
        flush();
        buffer = para;
      }
    }
    flush();
  };

  if (opts.body?.trim()) {
    pushBlocks(title, opts.body);
  }
  if (opts.fileText?.trim()) {
    const fileHeading = opts.fileLabel?.trim()
      ? `${title} — ${opts.fileLabel.trim()}`
      : `${title} — attached file`;
    pushBlocks(fileHeading, opts.fileText);
  }

  return chunks;
}
