import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { assetExists } from '@/lib/storage/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function safeDownloadName(value: string | null, format: 'pdf' | 'png') {
  const fallback = `paramount-onepager.${format}`;
  return (
    value?.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || fallback
  );
}

/**
 * Resolve a case+format to the current valid asset. This keeps persisted voice
 * attachments downloadable even if an older versioned URL became stale.
 */
export async function GET(req: Request) {
  const auth = await readSession();
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const query = new URL(req.url).searchParams;
  const caseId = query.get('caseId')?.trim() ?? '';
  const format = query.get('format') === 'png' ? 'png' : 'pdf';
  if (!caseId) {
    return NextResponse.json({ error: 'caseId is required' }, { status: 400 });
  }

  const mimeType = format === 'png' ? 'image/png' : 'application/pdf';
  const asset = await prisma.caseAsset.findFirst({
    where: { caseId, kind: 'ONE_PAGER', mimeType },
    orderBy: [{ generated: 'asc' }, { uploadedAt: 'desc' }],
    select: { uri: true, originalFilename: true },
  });
  if (!asset?.uri || !(await assetExists(asset.uri))) {
    return NextResponse.json(
      { error: 'One-pager file is not available' },
      { status: 404 },
    );
  }

  let body: ArrayBuffer;
  if (asset.uri.startsWith('/uploads/')) {
    const filePath = path.join(
      process.cwd(),
      'public',
      asset.uri.replace(/^\//, ''),
    );
    body = Uint8Array.from(await readFile(filePath)).buffer;
  } else {
    const response = await fetch(asset.uri);
    if (!response.ok) {
      return NextResponse.json(
        { error: 'One-pager storage returned an error' },
        { status: 502 },
      );
    }
    body = await response.arrayBuffer();
  }

  return new Response(body, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${safeDownloadName(
        asset.originalFilename,
        format,
      )}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
