import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { shareableKnowledgeFile } from '@/lib/storage/fileAccess';
import { serveStoredFile } from '@/lib/storage/serveFile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Buyer download of a shareable company document (never internal or retired ones). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await readSession();
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { id } = await params;
  const entry = await shareableKnowledgeFile(id);
  if (!entry?.fileUrl) {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }
  const label = (entry.shareLabel ?? '').trim() || entry.title.trim() || 'document';
  return serveStoredFile(entry.fileUrl, {
    filename: entry.fileName || `${label}.pdf`,
    contentType: entry.fileMime,
  });
}
