import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { BASE_PROMPT } from '@/lib/agent/base-prompt';
import { HARD_GUARDRAILS } from '@/lib/agent/guardrails';
import {
  isEditablePromptLayer,
  type EditablePromptLayer,
} from '@/lib/agent/promptLayers';

export const runtime = 'nodejs';

const PREVIEW_CHARS = 240;

const CODE_FALLBACK: Record<EditablePromptLayer, string | null> = {
  base: BASE_PROMPT,
  guidelines: null,
  guardrails: HARD_GUARDRAILS,
};

function resolveLayer(req: Request, payloadLayer?: unknown): EditablePromptLayer | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('layer');
  const raw = payloadLayer ?? fromQuery ?? 'guidelines';
  return isEditablePromptLayer(raw) ? raw : null;
}

/** List versions for one editable layer, newest first. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const layer = resolveLayer(req);
    if (!layer) {
      return NextResponse.json(
        { error: "layer must be 'base', 'guidelines', or 'guardrails'" },
        { status: 400 },
      );
    }

    const rows = await prisma.promptVersion.findMany({
      where: { layer },
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
      layer,
      codeFallback: CODE_FALLBACK[layer],
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

    let payload: { body?: string; label?: string; layer?: string };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const layer = resolveLayer(req, payload.layer);
    if (!layer) {
      return NextResponse.json(
        { error: "layer must be 'base', 'guidelines', or 'guardrails'" },
        { status: 400 },
      );
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
        where: { layer },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.promptVersion.create({
        data: {
          layer,
          body,
          label,
          version: (latest?.version ?? 0) + 1,
          author: auth.admin.name,
          createdById: auth.admin.id,
          // isLive defaults false — drafts never go live on save
        },
        select: { id: true, version: true, layer: true },
      });
    });

    console.log(
      `[admin/prompts] ${layer} draft v${created.version} by ${auth.admin.name} (${auth.admin.id})`,
    );

    return NextResponse.json({
      ok: true,
      id: created.id,
      version: created.version,
      layer: created.layer,
    });
  } catch (err) {
    console.error('[api/admin/prompts POST] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
