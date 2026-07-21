import { NextResponse } from 'next/server';
import type { AssetKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { uploadAsset, deleteAsset } from '@/lib/storage/blob';

export const runtime = 'nodejs';

const FILE_KINDS = new Set<AssetKind>(['ONE_PAGER', 'DECK_SLIDE', 'FULL_NARRATIVE']);
const ALL_KINDS = new Set<AssetKind>([
  'ONE_PAGER',
  'DEMO_VIDEO',
  'FULL_NARRATIVE',
  'DECK_SLIDE',
]);

const ALLOWED_MIME = new Set(['application/pdf', 'image/png']);

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
};

const MAX_BYTES = 40 * 1024 * 1024; // 40 MB

function isAssetKind(v: string): v is AssetKind {
  return ALL_KINDS.has(v as AssetKind);
}

/** List assets for a case. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { caseId } = await params;
    const caseExists = await prisma.caseStudy.findUnique({
      where: { id: caseId },
      select: { id: true, title: true },
    });
    if (!caseExists) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const assets = await prisma.caseAsset.findMany({
      where: { caseId },
      orderBy: [{ kind: 'asc' }, { uploadedAt: 'desc' }],
      select: {
        id: true,
        kind: true,
        uri: true,
        verified: true,
        originalFilename: true,
        mimeType: true,
        uploadedAt: true,
        uploadedBy: { select: { name: true } },
      },
    });

    return NextResponse.json({
      caseId,
      caseTitle: caseExists.title,
      assets: assets.map((a) => ({
        ...a,
        uploadedAt: a.uploadedAt.toISOString(),
        uploadedByName: a.uploadedBy?.name ?? null,
        uploadedBy: undefined,
      })),
    });
  } catch (err) {
    console.error('[api/admin/cases/assets GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Upload a file asset (ONE_PAGER / DECK_SLIDE / FULL_NARRATIVE) or attach a
 * DEMO_VIDEO url. multipart: kind + file | kind=DEMO_VIDEO + url
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { caseId } = await params;
    const caseExists = await prisma.caseStudy.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!caseExists) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const form = await req.formData();
    const kindRaw = String(form.get('kind') ?? '').trim();
    if (!isAssetKind(kindRaw)) {
      return NextResponse.json(
        { error: 'kind must be ONE_PAGER | DEMO_VIDEO | FULL_NARRATIVE | DECK_SLIDE' },
        { status: 400 },
      );
    }
    const kind = kindRaw;

    if (kind === 'DEMO_VIDEO') {
      const url = String(form.get('url') ?? '').trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { error: 'DEMO_VIDEO requires a valid http(s) url' },
          { status: 400 },
        );
      }
      const asset = await prisma.caseAsset.create({
        data: {
          caseId,
          kind,
          uri: url,
          mimeType: 'text/uri-list',
          originalFilename: null,
          uploadedById: auth.admin.id,
          verified: false,
        },
        select: {
          id: true,
          kind: true,
          uri: true,
          verified: true,
          originalFilename: true,
          mimeType: true,
          uploadedAt: true,
        },
      });
      console.log(
        `[admin/assets] UPLOAD DEMO_VIDEO case=${caseId} asset=${asset.id} by admin=${auth.admin.id}`,
      );
      return NextResponse.json({
        asset: { ...asset, uploadedAt: asset.uploadedAt.toISOString() },
      });
    }

    if (!FILE_KINDS.has(kind)) {
      return NextResponse.json({ error: 'Unsupported kind' }, { status: 400 });
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File must be between 1 byte and ${MAX_BYTES / (1024 * 1024)} MB` },
        { status: 400 },
      );
    }

    const filename = file.name || 'asset';
    const ext = filename.includes('.')
      ? `.${filename.split('.').pop()!.toLowerCase()}`
      : '';
    // Prefer declared mime; fall back to extension. Both must resolve to PDF or PNG.
    let mime = file.type || EXT_MIME[ext] || '';
    if (!mime && EXT_MIME[ext]) mime = EXT_MIME[ext];
    const extOk = ext === '.pdf' || ext === '.png';
    const mimeOk = ALLOWED_MIME.has(mime);
    if (!extOk || !mimeOk) {
      return NextResponse.json(
        { error: 'Only PDF and PNG files are allowed' },
        { status: 400 },
      );
    }
    // Normalize mime from extension when browser sends a generic/empty type
    mime = EXT_MIME[ext];

    const buffer = Buffer.from(await file.arrayBuffer());
    const { url } = await uploadAsset(buffer, filename, mime);

    const asset = await prisma.caseAsset.create({
      data: {
        caseId,
        kind,
        uri: url,
        originalFilename: filename,
        mimeType: mime,
        uploadedById: auth.admin.id,
        verified: false,
        generated: false,
      },
      select: {
        id: true,
        kind: true,
        uri: true,
        verified: true,
        originalFilename: true,
        mimeType: true,
        uploadedAt: true,
      },
    });

    // Official upload supersedes chat-generated caches for this case
    if (kind === 'ONE_PAGER') {
      const generated = await prisma.caseAsset.findMany({
        where: { caseId, kind: 'ONE_PAGER', generated: true },
        select: { id: true, uri: true },
      });
      for (const row of generated) {
        try {
          await deleteAsset(row.uri);
        } catch {
          // best-effort
        }
        await prisma.caseAsset.delete({ where: { id: row.id } }).catch(() => {});
      }
    }

    console.log(
      `[admin/assets] UPLOAD ${kind} case=${caseId} asset=${asset.id} by admin=${auth.admin.id}`,
    );

    return NextResponse.json({
      asset: { ...asset, uploadedAt: asset.uploadedAt.toISOString() },
    });
  } catch (err) {
    console.error('[api/admin/cases/assets POST] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
