/**
 * Stream a stored file from an app route. Callers check access first; this
 * only reads the bytes server-side and never redirects to a storage URL.
 */
import { NextResponse } from 'next/server';
import { readStoredFile } from './blob';

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function safeDownloadName(name: string, fallback: string): string {
  return (name || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || fallback;
}

export async function serveStoredFile(
  storedUrl: string,
  opts: { filename: string; contentType?: string | null; inline?: boolean },
): Promise<NextResponse> {
  const file = await readStoredFile(storedUrl);
  if (!file) {
    return NextResponse.json({ error: 'File is not available' }, { status: 404 });
  }
  const filename = safeDownloadName(opts.filename, 'document');
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const contentType = opts.contentType || file.contentType || MIME_BY_EXT[ext] || 'application/octet-stream';
  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${opts.inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
