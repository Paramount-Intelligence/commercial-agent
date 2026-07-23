/**
 * Extract readable text from admin knowledge attachments (PDF / DOCX).
 * Scanned/image-only PDFs return an empty string — callers must surface that.
 *
 * PDF: call pdf-parse in-process. It is listed in serverExternalPackages so
 * Next leaves it (and pdfjs-dist) in node_modules instead of webpack-bundling
 * them — no child-process / sibling-.cjs dance (those break on Vercel NFT).
 * DOCX: mammoth in-process (also externalized).
 */
import mammoth from 'mammoth';

export type ExtractResult = {
  text: string;
  /** True when the format is supported but no usable text was found. */
  empty: boolean;
  format: 'pdf' | 'docx';
};

const MIN_USEFUL_CHARS = 40;

function normalizeExtracted(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // Dynamic import keeps the heavy parser off the cold-start critical path
  // and resolves against the externalized package on serverless.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = typeof result?.text === 'string' ? result.text : '';
    return normalizeExtracted(text);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const converted = await mammoth.extractRawText({ buffer });
  return normalizeExtracted(converted.value ?? '');
}

export function detectKnowledgeFileFormat(
  filename: string,
  mime?: string | null,
): 'pdf' | 'docx' | null {
  const lower = filename.toLowerCase();
  const mimeLower = (mime ?? '').toLowerCase();
  if (lower.endsWith('.pdf') || mimeLower === 'application/pdf') return 'pdf';
  if (
    lower.endsWith('.docx') ||
    mimeLower ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  return null;
}

export async function extractKnowledgeFileText(opts: {
  buffer: Buffer;
  filename: string;
  mime?: string | null;
}): Promise<ExtractResult> {
  const format = detectKnowledgeFileFormat(opts.filename, opts.mime);
  if (!format) {
    throw new Error('Unsupported file type — upload a PDF or DOCX.');
  }

  const text =
    format === 'pdf'
      ? await extractPdf(opts.buffer)
      : await extractDocx(opts.buffer);

  return {
    text,
    empty: text.length < MIN_USEFUL_CHARS,
    format,
  };
}
