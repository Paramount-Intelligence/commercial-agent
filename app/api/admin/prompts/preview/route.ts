import { NextResponse } from 'next/server';
import {
  assembleSystemPromptDetailed,
  loadActiveBase,
  loadActiveGuidelines,
  loadActiveGuardrails,
} from '@/lib/agent/systemPrompt';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import {
  isEditablePromptLayer,
  type EditablePromptLayer,
} from '@/lib/agent/promptLayers';

export const runtime = 'nodejs';

/**
 * Read-only preview: assemble the FULL four-layer system prompt exactly as the
 * agent would run it. No DB write — nothing goes live from here.
 *
 * Optional layer + body: when provided, that layer is overridden with the
 * submitted text (or empty → fall back to live/code for that layer).
 * Case-index stays auto-generated.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    let payload: { body?: string; layer?: string };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const layerRaw = payload.layer;
    const layer: EditablePromptLayer | null =
      layerRaw === undefined || layerRaw === ''
        ? null
        : isEditablePromptLayer(layerRaw)
          ? layerRaw
          : null;
    if (layerRaw && !layer) {
      return NextResponse.json(
        { error: "layer must be 'base', 'guidelines', or 'guardrails'" },
        { status: 400 },
      );
    }

    const submitted = payload.body?.trim() ?? '';
    const source: 'submitted' | 'live' = submitted ? 'submitted' : 'live';

    const opts: {
      base?: string;
      guidelines?: string;
      guardrails?: string;
    } = {};

    if (layer === 'base') {
      opts.base = submitted || (await loadActiveBase()).body;
    } else if (layer === 'guidelines') {
      opts.guidelines = submitted || (await loadActiveGuidelines());
    } else if (layer === 'guardrails') {
      opts.guardrails = submitted || (await loadActiveGuardrails()).body;
    }

    const assembled = await assembleSystemPromptDetailed(opts);
    return NextResponse.json({
      prompt: assembled.prompt,
      source,
      layerSources: assembled.sources,
      previewLayer: layer,
    });
  } catch (err) {
    console.error('[api/admin/prompts/preview] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
