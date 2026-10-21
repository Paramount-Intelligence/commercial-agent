import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { serveStoredFile } from '@/lib/storage/serveFile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin download of a knowledge entry's original file (shareable or internal). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return adminUnauthorized();
  const { id } = await params;
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id },
    select: { fileUrl: true, fileName: true, fileMime: true },
  });
  if (!entry?.fileUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return serveStoredFile(entry.fileUrl, {
    filename: entry.fileName || `knowledge-${id}`,
    contentType: entry.fileMime,
    inline: true,
  });
}
