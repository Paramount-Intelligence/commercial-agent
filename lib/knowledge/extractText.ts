/**
 * Extract readable text from admin knowledge attachments (PDF / DOCX).
 * Scanned/image-only PDFs return an empty string — callers must surface that.
 *
 * PDF extraction runs in a Node subprocess (pdfParse.cli.cjs) because Next's
 * webpack shims break pdf-parse / createRequire inside the route bundle.
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
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
  const script = path.join(process.cwd(), 'lib', 'knowledge', 'pdfParse.cli.cjs');
  const tmpPath = path.join(
    os.tmpdir(),
    `admin-knowledge-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`,
  );
  await fs.writeFile(tmpPath, buffer);

  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [script, tmpPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            stderr.trim() || `PDF text extraction failed (exit ${code}).`,
          ),
        );
      });
    });

    let parsed: { text?: string };
    try {
      parsed = JSON.parse(raw) as { text?: string };
    } catch {
      throw new Error('PDF text extraction returned invalid output.');
    }
    return normalizeExtracted(parsed.text ?? '');
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
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
