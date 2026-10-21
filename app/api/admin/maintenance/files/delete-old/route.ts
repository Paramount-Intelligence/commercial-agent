import { NextResponse } from 'next/server';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { deleteLoggedOldFiles } from '@/lib/storage/fileMoveLog';
import { fileMigrationEnabled, parseMigrationRequest } from '@/lib/storage/migrationGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Later clean-up: delete exactly the old files listed by the file move
 * (FileMigrationLog), at most 50 per call, never a whole store, and never a
 * file a record still uses. Dry run (pending count only) unless apply=true.
 * 404 unless FILE_MIGRATION_ENABLED=true; admin only. Counts-only logs.
 */
export async function POST(req: Request) {
  if (!fileMigrationEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const auth = await requireAdminApi();
  if (!auth) return adminUnauthorized();
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // empty body = dry run
  }
  const { apply, limit } = parseMigrationRequest(body, new URL(req.url).searchParams);
  try {
    const result = await deleteLoggedOldFiles({ apply, limit });
    console.log('[admin/maintenance/files/delete-old]', { ...result, admin: auth.admin.id });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[admin/maintenance/files/delete-old] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Delete failed; see server logs.' }, { status: 500 });
  }
}
