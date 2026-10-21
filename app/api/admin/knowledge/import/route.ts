import { NextResponse } from 'next/server';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { importKnowledgeBundle, knowledgeImportEnabled } from '@/lib/knowledge/approved/importBundle';
import { invalidatePromptCache } from '@/lib/agent/promptCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Release step: load the approved-knowledge bundle (npm run knowledge:bundle)
 * on this deployment's database.
 * - 404 unless KNOWLEDGE_IMPORT_ENABLED=true (off by default; on only for the import).
 * - Admin session required.
 * - Body { "apply": true, "bundle": <bundle JSON> }; dry run unless apply is exactly true.
 * - Idempotent: unchanged docs are skipped; docs missing from the bundle are retired.
 * Logs carry counts only.
 */
export async function POST(req: Request) {
  if (!knowledgeImportEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const auth = await requireAdminApi();
  if (!auth) return adminUnauthorized();
  let body: { apply?: unknown; bundle?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body must be { apply, bundle }' }, { status: 400 });
  }
  try {
    const result = await importKnowledgeBundle(body.bundle, { apply: body.apply === true });
    if (result.ok && result.apply) invalidatePromptCache();
    const { refused, ...counts } = result;
    console.log('[admin/knowledge/import]', { ...counts, refused: refused?.length ?? 0, admin: auth.admin.id });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    console.error('[admin/knowledge/import] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Import failed; see server logs.' }, { status: 500 });
  }
}
