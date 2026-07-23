/**
 * Server-side text extraction for admin knowledge attachments.
 *
 * PDF: NOT extracted here — the admin browser runs pdfjs-dist and POSTs
 * `extractedText`. Serverless has failed repeatedly (sibling .cjs, DOMMatrix,
 * webpack bundling of "external" packages).
 *
 * DOCX: mammoth in-process (externalized).
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

/**
 * Server extraction — DOCX only. PDF must arrive as client `extractedText`.
 */
export async function extractKnowledgeFileText(opts: {
  buffer: Buffer;
  filename: string;
  mime?: string | null;
}): Promise<ExtractResult> {
  const format = detectKnowledgeFileFormat(opts.filename, opts.mime);
  if (!format) {
    throw new Error('Unsupported file type — upload a PDF or DOCX.');
  }
  if (format === 'pdf') {
    throw new Error(
      'PDF text must be extracted in the browser. Upload again from /admin/knowledge.',
    );
  }

  const text = await extractDocx(opts.buffer);
  return {
    text,
    empty: text.length < MIN_USEFUL_CHARS,
    format,
  };
}

export function normalizeClientExtractedText(raw: string): {
  text: string;
  empty: boolean;
} {
  const text = normalizeExtracted(raw);
  return { text, empty: text.length < MIN_USEFUL_CHARS };
}
