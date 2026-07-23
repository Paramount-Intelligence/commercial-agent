/**
 * Browser-only PDF text extraction via pdfjs-dist.
 * Runs in the admin UI — never imported from API routes / serverless.
 */
'use client';

import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist';

const MIN_USEFUL_CHARS = 40;

let workerConfigured = false;

function ensureWorker() {
  if (workerConfigured) return;
  // CDN worker matches the installed pdfjs-dist version. Avoids Next bundling
  // the worker into a broken serverless/client chunk path.
  GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  workerConfigured = true;
}

function normalizeExtracted(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract plain text from a PDF File/Blob in the browser.
 */
export async function extractPdfTextInBrowser(
  file: Blob,
): Promise<{ text: string; empty: boolean }> {
  ensureWorker();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;
  const parts: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? String(item.str) : ''))
        .filter(Boolean)
        .join(' ');
      if (pageText.trim()) parts.push(pageText);
    }
  } finally {
    await pdf.destroy().catch(() => {});
  }

  const text = normalizeExtracted(parts.join('\n\n'));
  return { text, empty: text.length < MIN_USEFUL_CHARS };
}
