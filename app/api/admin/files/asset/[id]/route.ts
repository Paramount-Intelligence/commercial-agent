import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { serveStoredFile } from '@/lib/storage/serveFile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin download of a case asset by id. External links (demo videos) are not files. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return adminUnauthorized();
  const { id } = await params;
  const asset = await prisma.caseAsset.findUnique({
    where: { id },
    select: { uri: true, originalFilename: true, mimeType: true, kind: true },
  });
  if (!asset?.uri || asset.kind === 'DEMO_VIDEO') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return serveStoredFile(asset.uri, {
    filename: asset.originalFilename || `asset-${id}`,
    contentType: asset.mimeType,
    inline: true,
  });
}
