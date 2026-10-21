import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { runGenerateOnepager } from '@/lib/agent/tools/generateCaseOnepager';
import { GENERATED_ONEPAGER_PREFIX } from '@/lib/storage/blob';
import { userWasGivenCaseFile } from '@/lib/storage/fileAccess';
import { serveStoredFile } from '@/lib/storage/serveFile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Buyer download of a case one-pager: ?caseId=…&format=pdf|png.
 * Allowed only when the one-pager was given in one of the buyer's own
 * conversations. Serves the official upload, else the current generated file
 * (regenerated if only an older version exists). Bytes are streamed; the
 * storage URL is never exposed.
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
  if (!(await userWasGivenCaseFile(auth.agentUser.id, caseId))) {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }

  const mimeType = format === 'png' ? 'image/png' : 'application/pdf';
  const pick = () =>
    prisma.caseAsset.findMany({
      where: { caseId, kind: 'ONE_PAGER', mimeType },
      orderBy: [{ generated: 'asc' }, { uploadedAt: 'desc' }],
      select: { uri: true, originalFilename: true, generated: true },
      take: 10,
    });
  const current = (rows: Awaited<ReturnType<typeof pick>>) =>
    rows.find((a) => !a.generated) ?? rows.find((a) => a.uri.includes(GENERATED_ONEPAGER_PREFIX));

  let asset = current(await pick());
  if (!asset) {
    // Only an older generated version exists: produce the current one.
    await runGenerateOnepager({ caseId, format }, new Set([caseId]));
    asset = current(await pick());
  }
  if (!asset) {
    return NextResponse.json({ error: 'One-pager file is not available' }, { status: 404 });
  }
  return serveStoredFile(asset.uri, {
    filename: asset.originalFilename || `paramount-onepager.${format}`,
    contentType: mimeType,
  });
}
