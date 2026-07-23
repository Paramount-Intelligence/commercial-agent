import { NextResponse } from 'next/server';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { buildCaseIndex } from '@/lib/agent/caseIndex';

export const runtime = 'nodejs';

/**
 * Read-only Layer 3 case index preview (titles + tech + PE, no IDs).
 * Regenerated live from CaseStudy data — never edited directly.
 */
export async function GET() {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const index = await buildCaseIndex();
    const lineCount = Math.max(0, index.split('\n').length - 1);

    return NextResponse.json({
      index,
      caseCount: lineCount,
      note: 'This index is generated from the case data above. Edit the cases to change it.',
    });
  } catch (err) {
    console.error('[api/admin/cases/index GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
