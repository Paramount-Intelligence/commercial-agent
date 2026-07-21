import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { deleteAsset } from '@/lib/storage/blob';

export const runtime = 'nodejs';

/** Delete CaseAsset row + underlying blob (if applicable). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;
    const asset = await prisma.caseAsset.findUnique({
      where: { id },
      select: { id: true, uri: true, kind: true, caseId: true },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    await deleteAsset(asset.uri);
    await prisma.caseAsset.delete({ where: { id: asset.id } });

    console.log(
      `[admin/assets] DELETE asset=${asset.id} kind=${asset.kind} case=${asset.caseId} by admin=${auth.admin.id}`,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/admin/assets DELETE] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Toggle verified (or set explicitly). Body: { verified: boolean } */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;
    let body: { verified?: boolean };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.verified !== 'boolean') {
      return NextResponse.json({ error: 'verified (boolean) is required' }, { status: 400 });
    }

    const asset = await prisma.caseAsset.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const updated = await prisma.caseAsset.update({
      where: { id },
      data: { verified: body.verified },
      select: { id: true, verified: true },
    });

    return NextResponse.json({ ok: true, verified: updated.verified });
  } catch (err) {
    console.error('[api/admin/assets PATCH] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
