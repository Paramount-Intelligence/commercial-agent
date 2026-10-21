/**
 * Move stored files from a public Blob store (or the old local folder) into
 * the private store configured now (lib/storage/blob.ts storageMode: on
 * Vercel the private store is reached with OIDC via BLOB_PRIVATE_STORE_ID).
 *
 * - Dry run by default: lists what would change, reads and writes nothing.
 *   Applying needs apply === true.
 * - Copies files and updates records. Never deletes the old files. Every old
 *   file made obsolete (copied, or a dropped cache) is written to the private
 *   FileMigrationLog list; a separate later step deletes exactly those files
 *   (lib/storage/fileMoveLog.ts, RELEASE_PLAN.md). Generated caches are not
 *   copied: their records are removed or cleared so they regenerate.
 * - Idempotent: only records whose URL is legacy (public Blob URL or
 *   /uploads/ path) are touched, one record per update, so a second run
 *   finds nothing left.
 * - Small batches when applying (default 25, at most 50 records per call).
 *
 * Run from: POST /api/admin/maintenance/files on the deployment (gated by
 * FILE_MIGRATION_ENABLED=true) or scripts/migrate-files-to-private.ts (dry run
 * from a laptop).
 */
import { prisma } from '../db';
import { readStoredFile, storageMode, uploadAsset, uploadKnowledgeFile, type StoredFile } from './blob';

export const MAX_BATCH = 50;
export const DEFAULT_BATCH = 25;

export type MigrationAction = 'copy' | 'delete-generated' | 'clear-cache' | 'skip-missing';

export type MigrationRow = {
  table: 'CaseAsset' | 'KnowledgeEntry' | 'Lead' | 'Conversation';
  id: string;
  action: MigrationAction;
  bytes?: number;
};

/** Data and storage access, injectable for tests. */
export type MigrationStore = {
  caseAssets(): Promise<Array<{ id: string; uri: string; generated: boolean; mimeType: string | null; originalFilename: string | null }>>;
  knowledgeFiles(): Promise<Array<{ id: string; fileUrl: string; fileMime: string | null; fileName: string | null }>>;
  leadPdfs(): Promise<Array<{ id: string; pdfUrl: string }>>;
  transcriptCaches(): Promise<Array<{ id: string; transcriptPdfUrl: string }>>;
  read(url: string): Promise<StoredFile | null>;
  uploadAsset(buffer: Buffer, filename: string, contentType: string, folder?: string): Promise<{ url: string }>;
  uploadKnowledge(buffer: Buffer, filename: string, contentType: string): Promise<{ url: string }>;
  setCaseAssetUri(id: string, uri: string): Promise<void>;
  removeCaseAsset(id: string): Promise<void>;
  setKnowledgeFileUrl(id: string, url: string): Promise<void>;
  setLeadPdfUrl(id: string, url: string): Promise<void>;
  clearTranscriptCache(id: string): Promise<void>;
  /** Record an old file this move made obsolete (private list for the later clean-up). */
  logMove(entry: { tableName: MigrationRow['table']; recordId: string; action: MigrationAction; oldUrl: string; newUrl?: string }): Promise<void>;
  access(): { access: 'private' | 'public'; kind: string };
};

export const prismaMigrationStore: MigrationStore = {
  caseAssets: () =>
    prisma.caseAsset.findMany({
      where: { kind: { not: 'DEMO_VIDEO' } },
      select: { id: true, uri: true, generated: true, mimeType: true, originalFilename: true },
    }),
  knowledgeFiles: async () =>
    (
      await prisma.knowledgeEntry.findMany({
        where: { fileUrl: { not: null } },
        select: { id: true, fileUrl: true, fileMime: true, fileName: true },
      })
    ).map((e) => ({ ...e, fileUrl: e.fileUrl! })),
  leadPdfs: async () =>
    (await prisma.lead.findMany({ where: { pdfUrl: { not: null } }, select: { id: true, pdfUrl: true } })).map((l) => ({
      id: l.id,
      pdfUrl: l.pdfUrl!,
    })),
  transcriptCaches: async () =>
    (
      await prisma.conversation.findMany({
        where: { transcriptPdfUrl: { not: null } },
        select: { id: true, transcriptPdfUrl: true },
      })
    ).map((c) => ({ id: c.id, transcriptPdfUrl: c.transcriptPdfUrl! })),
  read: readStoredFile,
  uploadAsset,
  uploadKnowledge: uploadKnowledgeFile,
  setCaseAssetUri: async (id, uri) => void (await prisma.caseAsset.update({ where: { id }, data: { uri } })),
  removeCaseAsset: async (id) => void (await prisma.caseAsset.delete({ where: { id } })),
  setKnowledgeFileUrl: async (id, fileUrl) => void (await prisma.knowledgeEntry.update({ where: { id }, data: { fileUrl } })),
  setLeadPdfUrl: async (id, pdfUrl) => void (await prisma.lead.update({ where: { id }, data: { pdfUrl } })),
  clearTranscriptCache: async (id) =>
    void (await prisma.conversation.update({
      where: { id },
      data: { transcriptPdfUrl: null, transcriptPdfThroughAt: null },
    })),
  logMove: async (e) => void (await prisma.fileMigrationLog.create({ data: { ...e, newUrl: e.newUrl ?? null } })),
  access: () => {
    const m = storageMode();
    return { access: m.access, kind: m.kind };
  },
};

export function isLegacyFileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('/uploads/') || /\.public\.blob\.vercel-storage\.com\//i.test(url);
}

const fileName = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() || 'file');

/** Counts per "Table:action", for logs and responses (no ids, no URLs). */
export function countRows(rows: MigrationRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, r) => {
    const k = `${r.table}:${r.action}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

type Step = { row: MigrationRow; run: () => Promise<MigrationRow> };

export async function migrateFiles(
  opts: { apply?: boolean; limit?: number } = {},
  store: MigrationStore = prismaMigrationStore,
): Promise<{ apply: boolean; access: 'private' | 'public'; mode: string; rows: MigrationRow[]; remaining: number }> {
  const apply = opts.apply === true;
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? DEFAULT_BATCH), MAX_BATCH));
  const mode = store.access();
  if (apply && mode.access !== 'private') {
    throw new Error(
      `Storage mode is ${mode.kind} (not a private store): refusing to move files. ` +
        'Run the move on the deployment, where the private store is reached with OIDC.',
    );
  }

  // Plan: one step per legacy record. Nothing is read or written yet.
  const steps: Step[] = [];
  const copy = (
    table: MigrationRow['table'],
    id: string,
    url: string,
    write: (file: StoredFile) => Promise<string>,
  ): Step => ({
    row: { table, id, action: 'copy' },
    run: async () => {
      const file = await store.read(url);
      if (!file) return { table, id, action: 'skip-missing' };
      const newUrl = await write(file);
      await store.logMove({ tableName: table, recordId: id, action: 'copy', oldUrl: url, newUrl });
      return { table, id, action: 'copy', bytes: file.buffer.length };
    },
  });

  for (const a of (await store.caseAssets()).filter((x) => isLegacyFileUrl(x.uri))) {
    if (a.generated) {
      steps.push({
        row: { table: 'CaseAsset', id: a.id, action: 'delete-generated' },
        run: async () => {
          await store.removeCaseAsset(a.id); // the record only; the old file stays
          await store.logMove({ tableName: 'CaseAsset', recordId: a.id, action: 'delete-generated', oldUrl: a.uri });
          return { table: 'CaseAsset', id: a.id, action: 'delete-generated' };
        },
      });
    } else {
      steps.push(
        copy('CaseAsset', a.id, a.uri, async (file) => {
          const { url } = await store.uploadAsset(file.buffer, a.originalFilename || fileName(a.uri), a.mimeType || file.contentType || 'application/octet-stream');
          await store.setCaseAssetUri(a.id, url);
          return url;
        }),
      );
    }
  }
  for (const e of (await store.knowledgeFiles()).filter((x) => isLegacyFileUrl(x.fileUrl))) {
    steps.push(
      copy('KnowledgeEntry', e.id, e.fileUrl, async (file) => {
        const { url } = await store.uploadKnowledge(file.buffer, e.fileName || fileName(e.fileUrl), e.fileMime || file.contentType || 'application/octet-stream');
        await store.setKnowledgeFileUrl(e.id, url);
        return url;
      }),
    );
  }
  for (const l of (await store.leadPdfs()).filter((x) => isLegacyFileUrl(x.pdfUrl))) {
    steps.push(
      copy('Lead', l.id, l.pdfUrl, async (file) => {
        const { url } = await store.uploadAsset(file.buffer, `lead-${l.id}.pdf`, 'application/pdf', 'leads/');
        await store.setLeadPdfUrl(l.id, url);
        return url;
      }),
    );
  }
  for (const c of (await store.transcriptCaches()).filter((x) => isLegacyFileUrl(x.transcriptPdfUrl))) {
    steps.push({
      row: { table: 'Conversation', id: c.id, action: 'clear-cache' },
      run: async () => {
        await store.clearTranscriptCache(c.id);
        await store.logMove({ tableName: 'Conversation', recordId: c.id, action: 'clear-cache', oldUrl: c.transcriptPdfUrl });
        return { table: 'Conversation', id: c.id, action: 'clear-cache' };
      },
    });
  }

  if (!apply) {
    return { apply, access: mode.access, mode: mode.kind, rows: steps.map((s) => s.row), remaining: steps.length };
  }
  const rows: MigrationRow[] = [];
  for (const s of steps.slice(0, limit)) rows.push(await s.run());
  return { apply, access: mode.access, mode: mode.kind, rows, remaining: Math.max(0, steps.length - rows.length) };
}
