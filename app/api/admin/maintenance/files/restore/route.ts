import { NextResponse } from 'next/server';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { restoreUrlColumns, type UrlColumnExport } from '@/lib/storage/fileMoveLog';
import { fileMigrationEnabled } from '@/lib/storage/migrationGate';
import { oldPublicStoreHost } from '@/lib/storage/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Rollback: write a saved export (from /export) back into the four URL
 * columns. Body: { "apply": true, "data": <export JSON> }; dry run unless
 * apply is exactly true. Only https URLs on the old public store's host (the
 * store of BLOB_READ_WRITE_TOKEN) and only existing ids are accepted; the rest
 * is rejected and counted. 404 unless FILE_MIGRATION_ENABLED=true; admin only.
 */
export async function POST(req: Request) {
  if (!fileMigrationEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const auth = await requireAdminApi();
  if (!auth) return adminUnauthorized();
  let body: { apply?: unknown; data?: Partial<UrlColumnExport> } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body must be { apply, data }' }, { status: 400 });
  }
  const allowedHost = oldPublicStoreHost();
  if (!allowedHost) {
    return NextResponse.json({ error: 'Old public store not configured (BLOB_READ_WRITE_TOKEN); nothing can be restored.' }, { status: 409 });
  }
  const result = await restoreUrlColumns(body.data ?? {}, { apply: body.apply === true, allowedHost });
  console.log('[admin/maintenance/files/restore]', { ...result, admin: auth.admin.id });
  return NextResponse.json(result);
}
