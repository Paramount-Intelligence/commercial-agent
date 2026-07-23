import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { isEditablePromptLayer } from '@/lib/agent/promptLayers';

export const runtime = 'nodejs';

/**
 * Publish a version: atomically un-set every other live row for the layer and
 * set this one live. Rollback IS this endpoint — publish an older version.
 * Rows are never deleted (history/audit).
 *
 * Guardrails publish requires confirmSafetyChange: true (informed consent only —
 * publishing remains fully allowed).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;

    let payload: { confirmSafetyChange?: boolean } = {};
    try {
      const text = await req.text();
      if (text.trim()) payload = JSON.parse(text) as typeof payload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const target = await prisma.promptVersion.findUnique({
      where: { id },
      select: { id: true, layer: true, version: true, isLive: true },
    });
    if (!target || !isEditablePromptLayer(target.layer)) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    if (target.isLive) {
      return NextResponse.json({
        ok: true,
        alreadyLive: true,
        version: target.version,
        layer: target.layer,
      });
    }

    if (target.layer === 'guardrails' && payload.confirmSafetyChange !== true) {
      return NextResponse.json(
        {
          error:
            'Publishing guardrails requires confirmSafetyChange: true (I understand this changes the agent\'s safety rules).',
          requiresSafetyConfirm: true,
        },
        { status: 400 },
      );
    }

    // KEY RULE: exactly one live row per layer — enforced in one transaction
    await prisma.$transaction([
      prisma.promptVersion.updateMany({
        where: { layer: target.layer, isLive: true },
        data: { isLive: false },
      }),
      prisma.promptVersion.update({
        where: { id: target.id },
        data: { isLive: true },
      }),
    ]);

    console.log(
      `[admin/prompts] ${target.layer} v${target.version} published live by ${auth.admin.name} (${auth.admin.id})`,
    );
    return NextResponse.json({
      ok: true,
      version: target.version,
      layer: target.layer,
    });
  } catch (err) {
    console.error('[api/admin/prompts/publish] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
