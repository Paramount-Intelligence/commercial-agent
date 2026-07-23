/**
 * Resolve attachment text for knowledge create/update.
 * PDF → client `extractedText` only. DOCX → mammoth on the server.
 */
import {
  detectKnowledgeFileFormat,
  extractKnowledgeFileText,
  normalizeClientExtractedText,
} from './extractText';

export async function resolveKnowledgeAttachmentText(opts: {
  format: 'pdf' | 'docx';
  buffer: Buffer;
  filename: string;
  mime?: string | null;
  /** Browser-extracted PDF text (required for PDF). */
  extractedTextRaw: string | null;
}): Promise<{ text: string } | { error: string }> {
  if (opts.format === 'pdf') {
    if (!opts.extractedTextRaw?.trim()) {
      return {
        error:
          'PDF text was not provided. Use /admin/knowledge so the browser can extract text before upload.',
      };
    }
    const normalized = normalizeClientExtractedText(opts.extractedTextRaw);
    if (normalized.empty) {
      return {
        error:
          'This PDF has no extractable text (it may be a scanned image). OCR is not supported — paste the text into the body field, or upload a text-based PDF.',
      };
    }
    return { text: normalized.text };
  }

  try {
    const extracted = await extractKnowledgeFileText({
      buffer: opts.buffer,
      filename: opts.filename,
      mime: opts.mime,
    });
    if (extracted.empty) {
      return {
        error:
          'This DOCX has no extractable text. Paste content into the body field instead.',
      };
    }
    return { text: extracted.text };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : 'Failed to extract DOCX text.',
    };
  }
}

export function readExtractedTextField(form: FormData): string | null {
  const raw = form.get('extractedText');
  if (raw === null) return null;
  const text = String(raw);
  return text.trim() ? text : null;
}

export { detectKnowledgeFileFormat };
