import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const LAYER = 'guidelines';

/**
 * Publish a version: atomically un-set every other live row for the layer and
 * set this one live. Rollback IS this endpoint — publish an older version.
 * Rows are never deleted (history/audit).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;

    const target = await prisma.promptVersion.findUnique({
      where: { id },
      select: { id: true, layer: true, version: true, isLive: true },
    });
    if (!target || target.layer !== LAYER) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    if (target.isLive) {
      return NextResponse.json({ ok: true, alreadyLive: true, version: target.version });
    }

    // KEY RULE: exactly one live row per layer — enforced in one transaction
    await prisma.$transaction([
      prisma.promptVersion.updateMany({
        where: { layer: LAYER, isLive: true },
        data: { isLive: false },
      }),
      prisma.promptVersion.update({
        where: { id: target.id },
        data: { isLive: true },
      }),
    ]);

    console.log(
      `[admin/prompts] v${target.version} published live by ${auth.admin.name} (${auth.admin.id})`,
    );
    return NextResponse.json({ ok: true, version: target.version });
  } catch (err) {
    console.error('[api/admin/prompts/publish] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
