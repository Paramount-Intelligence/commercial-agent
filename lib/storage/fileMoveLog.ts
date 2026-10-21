/**
 * Release helpers around the file move (all run on the deployment through
 * gated admin routes; see RELEASE_PLAN.md):
 *
 * - exportUrlColumns: read-only rollback export, id + current value of the
 *   four URL columns. Taken before the move and kept privately outside the
 *   repo.
 * - restoreUrlColumns: write such an export back (rollback). Dry run unless
 *   apply is true.
 * - deleteLoggedOldFiles: delete exactly the old files listed in
 *   FileMigrationLog, in small batches, only if no record still points at
 *   them. Never deletes a store. Dry run unless apply is true.
 */
import { unlink } from 'fs/promises';
import path from 'path';
import { del } from '@vercel/blob';
import { prisma } from '../db';
import { MAX_BATCH, DEFAULT_BATCH } from './migrateFiles';

export type UrlColumnExport = {
  exportedAt: string;
  CaseAsset: Array<{ id: string; uri: string }>;
  KnowledgeEntry: Array<{ id: string; fileUrl: string }>;
  Lead: Array<{ id: string; pdfUrl: string }>;
  Conversation: Array<{ id: string; transcriptPdfUrl: string }>;
};

export type FileMoveLogStore = {
  exportColumns(): Promise<Omit<UrlColumnExport, 'exportedAt'>>;
  setColumn(table: keyof Omit<UrlColumnExport, 'exportedAt'>, id: string, value: string): Promise<boolean>;
  pendingOldFiles(limit: number): Promise<Array<{ id: string; oldUrl: string }>>;
  countPendingOldFiles(): Promise<number>;
  isReferenced(url: string): Promise<boolean>;
  deleteOldFile(url: string): Promise<void>;
  markDeleted(id: string): Promise<void>;
  /** A file still in use is never deleted; mark it so batches move on. */
  markKept(id: string): Promise<void>;
};

const LOCAL_PREFIX = '/uploads/';

export const prismaFileMoveLogStore: FileMoveLogStore = {
  exportColumns: async () => ({
    CaseAsset: await prisma.caseAsset.findMany({ select: { id: true, uri: true }, orderBy: { id: 'asc' } }),
    KnowledgeEntry: (await prisma.knowledgeEntry.findMany({ where: { fileUrl: { not: null } }, select: { id: true, fileUrl: true }, orderBy: { id: 'asc' } })).map((e) => ({ id: e.id, fileUrl: e.fileUrl! })),
    Lead: (await prisma.lead.findMany({ where: { pdfUrl: { not: null } }, select: { id: true, pdfUrl: true }, orderBy: { id: 'asc' } })).map((l) => ({ id: l.id, pdfUrl: l.pdfUrl! })),
    Conversation: (await prisma.conversation.findMany({ where: { transcriptPdfUrl: { not: null } }, select: { id: true, transcriptPdfUrl: true }, orderBy: { id: 'asc' } })).map((c) => ({ id: c.id, transcriptPdfUrl: c.transcriptPdfUrl! })),
  }),
  setColumn: async (table, id, value) => {
    const r =
      table === 'CaseAsset'
        ? await prisma.caseAsset.updateMany({ where: { id }, data: { uri: value } })
        : table === 'KnowledgeEntry'
          ? await prisma.knowledgeEntry.updateMany({ where: { id }, data: { fileUrl: value } })
          : table === 'Lead'
            ? await prisma.lead.updateMany({ where: { id }, data: { pdfUrl: value } })
            : await prisma.conversation.updateMany({ where: { id }, data: { transcriptPdfUrl: value } });
    return r.count === 1;
  },
  pendingOldFiles: (limit) =>
    prisma.fileMigrationLog.findMany({ where: { oldDeletedAt: null, action: { not: 'kept' } }, orderBy: { movedAt: 'asc' }, take: limit, select: { id: true, oldUrl: true } }),
  countPendingOldFiles: () => prisma.fileMigrationLog.count({ where: { oldDeletedAt: null, action: { not: 'kept' } } }),
  isReferenced: async (url) =>
    (await prisma.caseAsset.count({ where: { uri: url } })) +
      (await prisma.knowledgeEntry.count({ where: { fileUrl: url } })) +
      (await prisma.lead.count({ where: { pdfUrl: url } })) +
      (await prisma.conversation.count({ where: { transcriptPdfUrl: url } })) >
    0,
  deleteOldFile: async (url) => {
    if (url.startsWith(LOCAL_PREFIX)) {
      const rel = url.slice(LOCAL_PREFIX.length).replace(/\.\.+/g, '');
      for (const dir of [path.join(process.cwd(), '.data', 'uploads'), path.join(process.cwd(), 'public', 'uploads')]) {
        await unlink(path.join(dir, rel)).catch(() => {});
      }
      return;
    }
    // Old files live in the old public store: its own token deletes them.
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (!token) throw new Error('No token for the old store; cannot delete its files.');
    await del(url, { token });
  },
  markDeleted: async (id) => void (await prisma.fileMigrationLog.update({ where: { id }, data: { oldDeletedAt: new Date() } })),
  markKept: async (id) => void (await prisma.fileMigrationLog.update({ where: { id }, data: { action: 'kept' } })),
};

export async function exportUrlColumns(store: FileMoveLogStore = prismaFileMoveLogStore): Promise<UrlColumnExport> {
  return { exportedAt: new Date().toISOString(), ...(await store.exportColumns()) };
}

/** Rollback: write an export back. Unknown records are skipped. */
export async function restoreUrlColumns(
  data: Partial<UrlColumnExport>,
  opts: { apply?: boolean } = {},
  store: FileMoveLogStore = prismaFileMoveLogStore,
): Promise<{ apply: boolean; counts: Record<string, number>; missing: number }> {
  const apply = opts.apply === true;
  const counts: Record<string, number> = {};
  let missing = 0;
  const items: Array<[keyof Omit<UrlColumnExport, 'exportedAt'>, string, string]> = [
    ...(data.CaseAsset ?? []).map((r) => ['CaseAsset', r.id, r.uri] as const),
    ...(data.KnowledgeEntry ?? []).map((r) => ['KnowledgeEntry', r.id, r.fileUrl] as const),
    ...(data.Lead ?? []).map((r) => ['Lead', r.id, r.pdfUrl] as const),
    ...(data.Conversation ?? []).map((r) => ['Conversation', r.id, r.transcriptPdfUrl] as const),
  ].filter((x): x is [keyof Omit<UrlColumnExport, 'exportedAt'>, string, string] => typeof x[1] === 'string' && typeof x[2] === 'string');
  for (const [table, id, value] of items) {
    counts[table] = (counts[table] ?? 0) + 1;
    if (apply && !(await store.setColumn(table, id, value))) missing++;
  }
  return { apply, counts, missing };
}

/** Delete listed old files, one small batch per call. Skips (and keeps) any file a record still uses. */
export async function deleteLoggedOldFiles(
  opts: { apply?: boolean; limit?: number } = {},
  store: FileMoveLogStore = prismaFileMoveLogStore,
): Promise<{ apply: boolean; deleted: number; keptInUse: number; failed: number; pending: number }> {
  const apply = opts.apply === true;
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? DEFAULT_BATCH), MAX_BATCH));
  if (!apply) return { apply, deleted: 0, keptInUse: 0, failed: 0, pending: await store.countPendingOldFiles() };
  let deleted = 0;
  let keptInUse = 0;
  let failed = 0;
  for (const row of await store.pendingOldFiles(limit)) {
    if (await store.isReferenced(row.oldUrl)) {
      await store.markKept(row.id);
      keptInUse++;
      continue;
    }
    try {
      await store.deleteOldFile(row.oldUrl);
      await store.markDeleted(row.id);
      deleted++;
    } catch {
      failed++;
    }
  }
  return { apply, deleted, keptInUse, failed, pending: await store.countPendingOldFiles() };
}
