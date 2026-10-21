/**
 * Chunking for approved knowledge, as measured in KNOWLEDGE_DESIGN.md §5
 * (variant c): ~300-token windows (~4 characters per token) with 15% overlap,
 * cut on whitespace, over the whole document. Each chunk carries a contextual
 * header (document, type, industry, section) that is embedded with it.
 */
import type { ChunkInput, KnowledgeDocInput } from './types';

export const WINDOW_TOKENS = 300;
export const OVERLAP = 0.15;
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type Section = { heading: string; text: string };

/** Split a Markdown body on "## " headings; the "# " title line is dropped. */
export function sections(body: string): Section[] {
  const out: Section[] = [];
  let heading = 'Overview';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ heading, text });
  };
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    if (/^#\s/.test(line)) continue;
    const m = line.match(/^##+\s+(.*)/);
    if (m) {
      flush();
      heading = m[1].trim();
      buf = [];
    } else buf.push(line);
  }
  flush();
  return out;
}

export function buildHeader(doc: Pick<KnowledgeDocInput, 'title' | 'type' | 'metadata'>, section: string): string {
  return [
    `Document: ${doc.title}`,
    `Type: ${doc.type}`,
    ...(doc.metadata.industry ? [`Industry: ${doc.metadata.industry}`] : []),
    `Section: ${section}`,
  ].join('\n');
}

/** Windows of ~`tokens` tokens, 15% overlap, starting and ending on whitespace. Returns [start, end) offsets. */
export function windows(text: string, tokens = WINDOW_TOKENS): Array<[number, number]> {
  const size = tokens * CHARS_PER_TOKEN;
  const step = Math.round(size * (1 - OVERLAP));
  const out: Array<[number, number]> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const cut = text.lastIndexOf(' ', end);
      if (cut > start) end = cut;
    }
    out.push([start, end]);
    if (end >= text.length) break;
    let next = start + step;
    if (next >= end) next = end;
    const ws = text.indexOf(' ', next);
    start = ws === -1 || ws >= end ? next : ws + 1;
  }
  return out;
}

export function buildChunks(doc: Pick<KnowledgeDocInput, 'title' | 'type' | 'metadata' | 'body'>): ChunkInput[] {
  const secs = sections(doc.body);
  // One text with section labels; remember where each section starts so a
  // window's header names the section it begins in.
  let text = '';
  const starts: Array<{ at: number; heading: string }> = [];
  for (const s of secs) {
    if (text) text += '\n\n';
    starts.push({ at: text.length, heading: s.heading });
    text += `${s.heading}\n${s.text}`;
  }
  return windows(text).map(([a, b], ordinal) => {
    const heading = [...starts].reverse().find((s) => s.at <= a)?.heading ?? 'Overview';
    const header = buildHeader(doc, heading);
    const content = text.slice(a, b).trim();
    return { ordinal, header, content, tokenCount: estimateTokens(`${header}\n\n${content}`) };
  });
}

/** The exact text that is embedded for a chunk. */
export function embeddingText(c: Pick<ChunkInput, 'header' | 'content'>): string {
  return `${c.header}\n\n${c.content}`;
}
