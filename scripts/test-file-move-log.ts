/**
 * Unit tests for the release helpers around the file move (no database):
 * rollback export and restore, and deleting only the listed old files.
 *
 *   npx tsx scripts/test-file-move-log.ts
 */
import { deleteLoggedOldFiles, exportUrlColumns, restoreUrlColumns, type FileMoveLogStore } from '../lib/storage/fileMoveLog';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const PUB = (n: string) => `https://abc.public.blob.vercel-storage.com/${n}`;
const PRIV = (n: string) => `https://abc.private.blob.vercel-storage.com/${n}`;

function fake() {
  const cols = {
    CaseAsset: [{ id: 'a1', uri: PRIV('a1.pdf') }],
    KnowledgeEntry: [{ id: 'k1', fileUrl: PRIV('k1.pdf') }],
    Lead: [{ id: 'l1', pdfUrl: PRIV('l1.pdf') }],
    Conversation: [] as Array<{ id: string; transcriptPdfUrl: string }>,
  };
  const log = [
    { id: 'm1', oldUrl: PUB('a1.pdf'), action: 'copy', deleted: false },
    { id: 'm2', oldUrl: PUB('k1.pdf'), action: 'copy', deleted: false },
    { id: 'm3', oldUrl: PUB('l1.pdf'), action: 'copy', deleted: false },
    { id: 'm4', oldUrl: PUB('shared.pdf'), action: 'copy', deleted: false },
  ];
  const deletedFiles: string[] = [];
  let referenced = new Set<string>([PUB('shared.pdf')]);
  const store: FileMoveLogStore = {
    exportColumns: async () => JSON.parse(JSON.stringify(cols)),
    setColumn: async (table, id, value) => {
      const rows = cols[table] as Array<Record<string, string>>;
      const r = rows.find((x) => x.id === id);
      if (!r) return false;
      const key = Object.keys(r).find((k) => k !== 'id')!;
      r[key] = value;
      return true;
    },
    pendingOldFiles: async (limit) => log.filter((r) => !r.deleted && r.action !== 'kept').slice(0, limit).map(({ id, oldUrl }) => ({ id, oldUrl })),
    countPendingOldFiles: async () => log.filter((r) => !r.deleted && r.action !== 'kept').length,
    isReferenced: async (url) => referenced.has(url),
    deleteOldFile: async (url) => void deletedFiles.push(url),
    markDeleted: async (id) => void (log.find((r) => r.id === id)!.deleted = true),
    markKept: async (id) => void (log.find((r) => r.id === id)!.action = 'kept'),
  };
  return { store, cols, log, deletedFiles, setReferenced: (s: Set<string>) => (referenced = s) };
}

async function main() {
  // Export → restore round trip (rollback).
  {
    const { store, cols } = fake();
    const before = await exportUrlColumns(store);
    ok('export lists id + value for the four columns', before.CaseAsset[0].uri === PRIV('a1.pdf') && before.KnowledgeEntry.length === 1 && before.Lead.length === 1 && Array.isArray(before.Conversation) && Boolean(before.exportedAt));
    cols.CaseAsset[0].uri = PRIV('changed.pdf');
    const dry = await restoreUrlColumns(before, {}, store);
    ok('restore is a dry run by default (nothing written)', !dry.apply && cols.CaseAsset[0].uri === PRIV('changed.pdf') && dry.counts.CaseAsset === 1);
    const applied = await restoreUrlColumns(before, { apply: true }, store);
    ok('restore with apply writes the exported values back', applied.apply && cols.CaseAsset[0].uri === PRIV('a1.pdf') && applied.missing === 0);
    const missing = await restoreUrlColumns({ CaseAsset: [{ id: 'gone', uri: 'x' }] }, { apply: true }, store);
    ok('restore skips records that no longer exist', missing.missing === 1);
    const junk = await restoreUrlColumns({ CaseAsset: [{ id: 1 as unknown as string, uri: 'x' }] }, { apply: true }, store);
    ok('restore ignores malformed rows', (junk.counts.CaseAsset ?? 0) === 0);
  }

  // Delete only listed old files.
  {
    const { store, log, deletedFiles } = fake();
    const dry = await deleteLoggedOldFiles({}, store);
    ok('delete-old is a dry run by default (pending count only)', !dry.apply && dry.pending === 4 && deletedFiles.length === 0);
    const r1 = await deleteLoggedOldFiles({ apply: true, limit: 2 }, store);
    ok('deletes one small batch of listed files', r1.deleted === 2 && deletedFiles.length === 2);
    const r2 = await deleteLoggedOldFiles({ apply: true, limit: 50 }, store);
    ok('a file still referenced by a record is kept, not deleted', r2.keptInUse === 1 && !deletedFiles.includes(PUB('shared.pdf')));
    ok('all other listed files deleted, nothing pending', r2.pending === 0 && deletedFiles.length === 3);
    ok('only listed files are ever deleted', deletedFiles.every((u) => log.some((l) => l.oldUrl === u)));
    const r3 = await deleteLoggedOldFiles({ apply: true }, store);
    ok('idempotent: a second run deletes nothing', r3.deleted === 0 && r3.pending === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
