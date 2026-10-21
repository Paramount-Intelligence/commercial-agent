import { NextResponse } from 'next/server';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { exportUrlColumns } from '@/lib/storage/fileMoveLog';
import { fileMigrationEnabled } from '@/lib/storage/migrationGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Read-only rollback export: id + current value of CaseAsset.uri,
 * KnowledgeEntry.fileUrl, Lead.pdfUrl and Conversation.transcriptPdfUrl, as a
 * JSON download. Save it privately outside the repo before the file move.
 * 404 unless FILE_MIGRATION_ENABLED=true; admin session required.
 */
export async function GET() {
  if (!fileMigrationEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const auth = await requireAdminApi();
  if (!auth) return adminUnauthorized();
  const data = await exportUrlColumns();
  console.log('[admin/maintenance/files/export]', {
    CaseAsset: data.CaseAsset.length,
    KnowledgeEntry: data.KnowledgeEntry.length,
    Lead: data.Lead.length,
    Conversation: data.Conversation.length,
    admin: auth.admin.id,
  });
  return new NextResponse(JSON.stringify(data, null, 1), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="file-url-columns-${data.exportedAt.slice(0, 10)}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
