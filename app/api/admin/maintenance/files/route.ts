import { NextResponse } from 'next/server';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { countRows, migrateFiles } from '@/lib/storage/migrateFiles';
import { fileMigrationEnabled, parseMigrationRequest } from '@/lib/storage/migrationGate';
import { repairLeadPdfs } from '@/lib/storage/repairLeadPdfs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Release step: move stored files into the private store.
 * - 404 unless FILE_MIGRATION_ENABLED=true on this deployment (off by default;
 *   turn it on only for the migration window).
 * - Admin session required.
 * - Dry run unless apply=true (body {"apply": true} or ?apply=true).
 * - Copies files and updates records; never deletes old public files.
 * - Small batches; call again until "remaining" is 0.
 * Logs and responses carry counts and record ids only (no URLs, no personal data).
 */
export async function POST(req: Request) {
  if (!fileMigrationEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const auth = await requireAdminApi();
  if (!auth) return adminUnauthorized();

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // empty body = dry run
  }
  const searchParams = new URL(req.url).searchParams;
  const { apply, limit } = parseMigrationRequest(body, searchParams);
  const leadPdfs =
    (body && typeof body === 'object' && (body as { leadPdfs?: unknown }).leadPdfs === true) ||
    searchParams.get('leadPdfs') === 'true';
  try {
    if (leadPdfs) {
      const result = await repairLeadPdfs({ apply, limit });
      console.log('[admin/maintenance/files]', {
        apply: result.apply,
        operation: 'lead-pdfs',
        counts: result.counts,
        remaining: result.remaining,
        admin: auth.admin.id,
      });
      return NextResponse.json(result);
    }
    const result = await migrateFiles({ apply, limit });
    const counts = countRows(result.rows);
    console.log('[admin/maintenance/files]', {
      apply: result.apply,
      mode: result.mode,
      counts,
      remaining: result.remaining,
      admin: auth.admin.id,
    });
    return NextResponse.json({
      apply: result.apply,
      access: result.access,
      mode: result.mode,
      counts,
      remaining: result.remaining,
      rows: result.rows.map(({ table, id, action, bytes }) => ({ table, id, action, bytes })),
    });
  } catch (err) {
    // Storage errors can carry URLs: log the error name only.
    console.error('[admin/maintenance/files] failed', err instanceof Error ? err.name : 'unknown');
    const refused = err instanceof Error && err.message.startsWith('Storage mode is');
    return NextResponse.json(
      { error: refused ? err.message : 'File move failed; see server logs.' },
      { status: refused ? 409 : 500 },
    );
  }
}
