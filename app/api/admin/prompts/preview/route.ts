import { NextResponse } from 'next/server';
import {
  assembleSystemPrompt,
  loadActiveGuidelines,
} from '@/lib/agent/systemPrompt';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

/**
 * Read-only preview: assemble the FULL system prompt exactly as the agent
 * would run it. No DB write — nothing goes live from here.
 *
 * Guidelines source:
 * - non-empty submitted body → preview THAT text as the guidelines layer
 * - empty/omitted body → fall back to the LIVE guidelines (same
 *   loadActiveGuidelines path the agent uses), so an empty editor previews
 *   the agent's true current state instead of a misleading "(no guidelines)".
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    let payload: { body?: string };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const submitted = payload.body?.trim() ?? '';
    const source: 'submitted' | 'live' = submitted ? 'submitted' : 'live';
    const guidelines = submitted || (await loadActiveGuidelines());

    const prompt = await assembleSystemPrompt({ guidelines });
    return NextResponse.json({ prompt, source });
  } catch (err) {
    console.error('[api/admin/prompts/preview] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
