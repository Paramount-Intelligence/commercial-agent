/**
 * Extract readable text from admin knowledge attachments (PDF / DOCX).
 * Scanned/image-only PDFs return an empty string — callers must surface that.
 *
 * PDF: pdf-parse@1.1.1 (pure Node, no pdfjs-dist / DOMMatrix). Loaded via
 * createRequire anchored at process.cwd() so serverless NFT-traced
 * node_modules resolve (import.meta.url can point inside the webpack bundle).
 * DOCX: mammoth in-process (also externalized).
 */
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import mammoth from 'mammoth';

export type ExtractResult = {
  text: string;
  /** True when the format is supported but no usable text was found. */
  empty: boolean;
  format: 'pdf' | 'docx';
};

const MIN_USEFUL_CHARS = 40;

type PdfParseFn = (data: Buffer) => Promise<{ text?: string }>;

function loadPdfParse(): PdfParseFn {
  const req = createRequire(
    pathToFileURL(path.join(process.cwd(), 'package.json')).href,
  );
  try {
    // Lib entry avoids the package root's historical self-test side effect.
    return req('pdf-parse/lib/pdf-parse.js') as PdfParseFn;
  } catch {
    return req('pdf-parse') as PdfParseFn;
  }
}

function normalizeExtracted(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfParse = loadPdfParse();
  const result = await pdfParse(buffer);
  return normalizeExtracted(
    typeof result?.text === 'string' ? result.text : '',
  );
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
