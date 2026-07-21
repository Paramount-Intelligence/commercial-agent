import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const LAYER = 'guidelines';
const PREVIEW_CHARS = 240;

/** List all guidelines versions, newest first. */
export async function GET() {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const rows = await prisma.promptVersion.findMany({
      where: { layer: LAYER },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        label: true,
        isLive: true,
        author: true,
        createdAt: true,
        body: true,
        createdBy: { select: { name: true } },
      },
    });

    return NextResponse.json({
      versions: rows.map((r) => ({
        id: r.id,
        version: r.version,
        label: r.label,
        isLive: r.isLive,
        createdByName: r.createdBy?.name ?? r.author,
        createdAt: r.createdAt.toISOString(),
        bodyPreview:
          r.body.length > PREVIEW_CHARS
            ? r.body.slice(0, PREVIEW_CHARS).trimEnd() + '…'
            : r.body,
        body: r.body,
      })),
    });
  } catch (err) {
    console.error('[api/admin/prompts GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Create a NEW version as a DRAFT (publishing is a separate, deliberate action). */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    let payload: { body?: string; label?: string };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const body = payload.body?.trim();
    const label = payload.label?.trim() || null;
    if (!body) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }

    // version = max + 1 for the layer, atomically with the create so two
    // simultaneous saves can't claim the same number (unique [layer, version]
    // backstops this anyway).
    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.promptVersion.findFirst({
        where: { layer: LAYER },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.promptVersion.create({
        data: {
          layer: LAYER,
          body,
          label,
          version: (latest?.version ?? 0) + 1,
          author: auth.admin.name,
          createdById: auth.admin.id,
          // isLive defaults false — drafts never go live on save
        },
        select: { id: true, version: true },
      });
    });

    return NextResponse.json({ ok: true, id: created.id, version: created.version });
  } catch (err) {
    console.error('[api/admin/prompts POST] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
