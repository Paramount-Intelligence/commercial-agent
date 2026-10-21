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
    CaseAsset: [{ id: 'a1', uri: PUB('a1.pdf') }],
    KnowledgeEntry: [{ id: 'k1', fileUrl: PUB('k1.pdf') }],
    Lead: [{ id: 'l1', pdfUrl: PUB('l1.pdf') }],
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
    exists: async (table, id) => (cols[table] as Array<{ id: string }>).some((x) => x.id === id),
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
  // Export → restore round trip (rollback), host and id checks.
  {
    const HOST = 'abc.public.blob.vercel-storage.com';
    const { store, cols } = fake();
    const before = await exportUrlColumns(store);
    ok('export lists id + value for the four columns', before.CaseAsset[0].uri === PUB('a1.pdf') && before.KnowledgeEntry.length === 1 && before.Lead.length === 1 && Array.isArray(before.Conversation) && Boolean(before.exportedAt));
    cols.CaseAsset[0].uri = PRIV('moved.pdf');
    const dry = await restoreUrlColumns(before, { allowedHost: HOST }, store);
    ok('restore is a dry run by default (nothing written)', !dry.apply && cols.CaseAsset[0].uri === PRIV('moved.pdf') && dry.counts.CaseAsset === 1);
    const applied = await restoreUrlColumns(before, { apply: true, allowedHost: HOST }, store);
    ok('restore writes exported old-store values back', applied.apply && cols.CaseAsset[0].uri === PUB('a1.pdf') && applied.rejectedHost === 0 && applied.rejectedId === 0);

    cols.CaseAsset[0].uri = PRIV('moved.pdf');
    const foreign = await restoreUrlColumns({ CaseAsset: [{ id: 'a1', uri: 'https://evil.example.com/a1.pdf' }] }, { apply: true, allowedHost: HOST }, store);
    ok('rejects a foreign host (and writes nothing)', foreign.rejectedHost === 1 && !foreign.counts.CaseAsset && cols.CaseAsset[0].uri === PRIV('moved.pdf'));
    const otherStore = await restoreUrlColumns({ CaseAsset: [{ id: 'a1', uri: 'https://zzz.public.blob.vercel-storage.com/a1.pdf' }] }, { apply: true, allowedHost: HOST }, store);
    ok('rejects another Blob store host', otherStore.rejectedHost === 1);
    const lookalike = await restoreUrlColumns({ CaseAsset: [{ id: 'a1', uri: 'https://abc.public.blob.vercel-storage.com.evil.com/a1.pdf' }] }, { apply: true, allowedHost: HOST }, store);
    ok('rejects a look-alike host', lookalike.rejectedHost === 1);
    const http = await restoreUrlColumns({ Lead: [{ id: 'l1', pdfUrl: 'http://abc.public.blob.vercel-storage.com/l1.pdf' }] }, { apply: true, allowedHost: HOST }, store);
    ok('rejects a non-https URL', http.rejectedHost === 1 && cols.Lead[0].pdfUrl === PUB('l1.pdf'));
    const userinfo = await restoreUrlColumns({ Lead: [{ id: 'l1', pdfUrl: 'https://x@abc.public.blob.vercel-storage.com/l1.pdf' }] }, { apply: true, allowedHost: HOST }, store);
    ok('rejects a URL with credentials', userinfo.rejectedHost === 1);
    const unknown = await restoreUrlColumns({ KnowledgeEntry: [{ id: 'no-such-id', fileUrl: PUB('k9.pdf') }] }, { apply: true, allowedHost: HOST }, store);
    ok('rejects an unknown id', unknown.rejectedId === 1 && !unknown.counts.KnowledgeEntry);
    const junk = await restoreUrlColumns({ CaseAsset: [{ id: 1 as unknown as string, uri: 'x' }] }, { apply: true, allowedHost: HOST }, store);
    ok('counts malformed rows', junk.malformed === 1);
    const noHost = await restoreUrlColumns(before, { apply: true, allowedHost: null }, store);
    ok('with no old-store host configured, everything is rejected', noHost.rejectedHost === 3 && Object.keys(noHost.counts).length === 0);
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
