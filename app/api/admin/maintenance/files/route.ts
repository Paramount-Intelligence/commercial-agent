import { NextResponse } from 'next/server';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { migrateFiles } from '@/lib/storage/migrateFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Release step: move stored files into the private store, in batches.
 * Body: { "apply": false | true, "limit": 25 }. Dry run unless apply is true.
 * Run repeatedly until "remaining" is false. Admin session required.
 */
export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (!auth) return adminUnauthorized();
  let body: { apply?: boolean; limit?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body = dry run
  }
  try {
    const result = await migrateFiles({ apply: body.apply === true, limit: body.limit });
    console.log(
      `[admin/maintenance/files] ${result.apply ? 'APPLY' : 'DRY RUN'} rows=${result.rows.length} remaining=${result.remaining} by admin=${auth.admin.id}`,
    );
    // Old and new storage URLs stay server-side: report ids and actions only.
    return NextResponse.json({
      apply: result.apply,
      access: result.access,
      remaining: result.remaining,
      rows: result.rows.map(({ table, id, action, bytes }) => ({ table, id, action, bytes })),
    });
  } catch (err) {
    console.error('[admin/maintenance/files] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
