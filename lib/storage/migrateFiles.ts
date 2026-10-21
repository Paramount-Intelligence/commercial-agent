/**
 * Move stored files from a public Blob store (or the old local folder) into
 * the private store configured now (lib/storage/blob.ts storageMode: on
 * Vercel the private store is reached with OIDC via BLOB_PRIVATE_STORE_ID).
 *
 * Dry run by default. Idempotent: only records whose URL is legacy (a public
 * Blob URL or a /uploads/ path) are touched, one record per update. Generated
 * caches are not copied: generated one-pagers are deleted (they regenerate on
 * demand with the current template) and transcript caches are cleared.
 *
 * Old public files are left in place; delete the old store once the move is
 * verified (that also ends the old public links).
 *
 * Run from: the admin route POST /api/admin/maintenance/files (production and
 * staging deployments) or scripts/migrate-files-to-private.ts (local/staging).
 */
import { prisma } from '../db';
import { readStoredFile, storageMode, uploadAsset, uploadKnowledgeFile } from './blob';

export type MigrationRow = {
  table: 'CaseAsset' | 'KnowledgeEntry' | 'Lead' | 'Conversation';
  id: string;
  action: 'copy' | 'delete-generated' | 'clear-cache' | 'skip-missing';
  bytes?: number;
  oldUrl?: string;
  newUrl?: string;
};

export function isLegacyFileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('/uploads/') || /\.public\.blob\.vercel-storage\.com\//i.test(url);
}

const fileName = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() || 'file');

export async function migrateFiles(opts: { apply?: boolean; limit?: number } = {}): Promise<{
  apply: boolean;
  access: 'private' | 'public';
  mode: string;
  rows: MigrationRow[];
  remaining: boolean;
}> {
  const apply = Boolean(opts.apply);
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const mode = storageMode();
  if (apply && mode.access !== 'private') {
    throw new Error(
      `Storage mode is ${mode.kind} (not a private store): refusing to move files. ` +
        'Run the move on the deployment (POST /api/admin/maintenance/files), where the private store is reached with OIDC.',
    );
  }
  const rows: MigrationRow[] = [];

  const assets = (
    await prisma.caseAsset.findMany({
      where: { kind: { not: 'DEMO_VIDEO' } },
      select: { id: true, uri: true, generated: true, mimeType: true, originalFilename: true },
    })
  ).filter((a) => isLegacyFileUrl(a.uri));
  const entries = (
    await prisma.knowledgeEntry.findMany({
      where: { fileUrl: { not: null } },
      select: { id: true, fileUrl: true, fileMime: true, fileName: true },
    })
  ).filter((e) => isLegacyFileUrl(e.fileUrl));
  const leads = (
    await prisma.lead.findMany({ where: { pdfUrl: { not: null } }, select: { id: true, pdfUrl: true } })
  ).filter((l) => isLegacyFileUrl(l.pdfUrl));
  const convs = (
    await prisma.conversation.findMany({
      where: { transcriptPdfUrl: { not: null } },
      select: { id: true, transcriptPdfUrl: true },
    })
  ).filter((c) => isLegacyFileUrl(c.transcriptPdfUrl));

  const work: Array<() => Promise<void>> = [];

  for (const a of assets) {
    work.push(async () => {
      if (a.generated) {
        rows.push({ table: 'CaseAsset', id: a.id, action: 'delete-generated', oldUrl: a.uri });
        if (apply) await prisma.caseAsset.delete({ where: { id: a.id } });
        return;
      }
      const file = await readStoredFile(a.uri);
      if (!file) return void rows.push({ table: 'CaseAsset', id: a.id, action: 'skip-missing', oldUrl: a.uri });
      let newUrl: string | undefined;
      if (apply) {
        newUrl = (await uploadAsset(file.buffer, a.originalFilename || fileName(a.uri), a.mimeType || file.contentType || 'application/octet-stream')).url;
        await prisma.caseAsset.update({ where: { id: a.id }, data: { uri: newUrl } });
      }
      rows.push({ table: 'CaseAsset', id: a.id, action: 'copy', bytes: file.buffer.length, oldUrl: a.uri, newUrl });
    });
  }
  for (const e of entries) {
    work.push(async () => {
      const file = await readStoredFile(e.fileUrl!);
      if (!file) return void rows.push({ table: 'KnowledgeEntry', id: e.id, action: 'skip-missing', oldUrl: e.fileUrl! });
      let newUrl: string | undefined;
      if (apply) {
        newUrl = (await uploadKnowledgeFile(file.buffer, e.fileName || fileName(e.fileUrl!), e.fileMime || file.contentType || 'application/octet-stream')).url;
        await prisma.knowledgeEntry.update({ where: { id: e.id }, data: { fileUrl: newUrl } });
      }
      rows.push({ table: 'KnowledgeEntry', id: e.id, action: 'copy', bytes: file.buffer.length, oldUrl: e.fileUrl!, newUrl });
    });
  }
  for (const l of leads) {
    work.push(async () => {
      const file = await readStoredFile(l.pdfUrl!);
      if (!file) return void rows.push({ table: 'Lead', id: l.id, action: 'skip-missing', oldUrl: l.pdfUrl! });
      let newUrl: string | undefined;
      if (apply) {
        newUrl = (await uploadAsset(file.buffer, `lead-${l.id}.pdf`, 'application/pdf', 'leads/')).url;
        await prisma.lead.update({ where: { id: l.id }, data: { pdfUrl: newUrl } });
      }
      rows.push({ table: 'Lead', id: l.id, action: 'copy', bytes: file.buffer.length, oldUrl: l.pdfUrl!, newUrl });
    });
  }
  for (const c of convs) {
    work.push(async () => {
      rows.push({ table: 'Conversation', id: c.id, action: 'clear-cache', oldUrl: c.transcriptPdfUrl! });
      if (apply) {
        await prisma.conversation.update({
          where: { id: c.id },
          data: { transcriptPdfUrl: null, transcriptPdfThroughAt: null },
        });
      }
    });
  }

  for (const step of work.slice(0, limit)) await step();
  return { apply, access: mode.access, mode: mode.kind, rows, remaining: work.length > limit };
}
