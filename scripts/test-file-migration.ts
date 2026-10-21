/**
 * Unit tests for the file-move maintenance step (no database, no network):
 * the env gate, request parsing, dry run, batching, idempotency, and that old
 * files are never deleted.
 *
 *   npx tsx scripts/test-file-migration.ts
 */
import { countRows, migrateFiles, type MigrationStore } from '../lib/storage/migrateFiles';
import { fileMigrationEnabled, parseMigrationRequest } from '../lib/storage/migrationGate';

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

// Gate.
ok('gate off when unset', !fileMigrationEnabled({}));
ok('gate off for "TRUE"', !fileMigrationEnabled({ FILE_MIGRATION_ENABLED: 'TRUE' }));
ok('gate off for "1"', !fileMigrationEnabled({ FILE_MIGRATION_ENABLED: '1' }));
ok('gate off for "false"', !fileMigrationEnabled({ FILE_MIGRATION_ENABLED: 'false' }));
ok('gate on only for "true"', fileMigrationEnabled({ FILE_MIGRATION_ENABLED: 'true' }));

// Request parsing: dry run unless apply is explicitly true.
const q = (s = '') => new URLSearchParams(s);
ok('empty body → dry run', parseMigrationRequest({}, q()).apply === false);
ok('apply:"true" string → dry run', parseMigrationRequest({ apply: 'true' }, q()).apply === false);
ok('apply:1 → dry run', parseMigrationRequest({ apply: 1 }, q()).apply === false);
ok('apply:true → apply', parseMigrationRequest({ apply: true }, q()).apply === true);
ok('?apply=true → apply', parseMigrationRequest(null, q('apply=true')).apply === true);
ok('?apply=1 → dry run', parseMigrationRequest(null, q('apply=1')).apply === false);
ok('limit parsed', parseMigrationRequest({ limit: 10 }, q()).limit === 10 && parseMigrationRequest({}, q('limit=7')).limit === 7);

const PUB = (n: string) => `https://abc.public.blob.vercel-storage.com/${n}`;
const PRIV = (n: string) => `https://abc.private.blob.vercel-storage.com/${n}`;

function fakeStore(access: 'private' | 'public') {
  const db = {
    assets: [
      { id: 'a1', uri: PUB('a1.pdf'), generated: false, mimeType: 'application/pdf', originalFilename: 'a1.pdf' },
      { id: 'a2', uri: PRIV('a2.pdf'), generated: false, mimeType: 'application/pdf', originalFilename: 'a2.pdf' },
      { id: 'g1', uri: PUB('g1.pdf'), generated: true, mimeType: 'application/pdf', originalFilename: null },
      { id: 'a3', uri: '/uploads/case-assets/a3.pdf', generated: false, mimeType: 'application/pdf', originalFilename: 'a3.pdf' },
    ],
    knowledge: [{ id: 'k1', fileUrl: PUB('k1.docx'), fileMime: null, fileName: 'k1.docx' }],
    leads: [{ id: 'l1', pdfUrl: PUB('l1.pdf') }],
    convs: [{ id: 'c1', transcriptPdfUrl: PUB('t1.pdf') }],
  };
  const calls = { read: 0, upload: 0, removeRecord: 0, writes: 0, deleteFile: 0 };
  const log: Array<{ tableName: string; recordId: string; action: string; oldUrl: string; newUrl?: string }> = [];
  let n = 0;
  const store: MigrationStore = {
    caseAssets: async () => db.assets.map((a) => ({ ...a })),
    knowledgeFiles: async () => db.knowledge.map((k) => ({ ...k })),
    leadPdfs: async () => db.leads.map((l) => ({ ...l })),
    transcriptCaches: async () => db.convs.filter((c) => c.transcriptPdfUrl).map((c) => ({ ...c })),
    read: async () => (calls.read++, { buffer: Buffer.from('%PDF'), contentType: 'application/pdf' }),
    uploadAsset: async () => (calls.upload++, { url: PRIV(`new-${++n}.pdf`) }),
    uploadKnowledge: async () => (calls.upload++, { url: PRIV(`new-${++n}.docx`) }),
    setCaseAssetUri: async (id, uri) => void (calls.writes++, (db.assets.find((a) => a.id === id)!.uri = uri)),
    removeCaseAsset: async (id) => void (calls.removeRecord++, (db.assets = db.assets.filter((a) => a.id !== id))),
    setKnowledgeFileUrl: async (id, url) => void (calls.writes++, (db.knowledge.find((k) => k.id === id)!.fileUrl = url)),
    setLeadPdfUrl: async (id, url) => void (calls.writes++, (db.leads.find((l) => l.id === id)!.pdfUrl = url)),
    clearTranscriptCache: async (id) => void (calls.writes++, (db.convs.find((c) => c.id === id)!.transcriptPdfUrl = '')),
    logMove: async (e) => void log.push(e),
    access: () => ({ access, kind: access === 'private' ? 'private-oidc' : 'local' }),
  };
  return { store, calls, db, log };
}

async function main() {
  // Dry run: lists everything, touches nothing.
  {
    const { store, calls, log } = fakeStore('public');
    const r = await migrateFiles({}, store);
    const c = countRows(r.rows);
    ok('dry run is the default', r.apply === false);
    ok('dry run reads, uploads and writes nothing', calls.read === 0 && calls.upload === 0 && calls.writes === 0 && calls.removeRecord === 0);
    ok('dry run lists only legacy records (private one skipped)', r.rows.length === 6 && !r.rows.some((x) => x.id === 'a2'));
    ok('dry run counts per action', c['CaseAsset:copy'] === 2 && c['CaseAsset:delete-generated'] === 1 && c['KnowledgeEntry:copy'] === 1 && c['Lead:copy'] === 1 && c['Conversation:clear-cache'] === 1);
    ok('dry run reports remaining work', r.remaining === 6);
    ok('dry run writes nothing to the move list', log.length === 0);
    ok('dry run works without a private store', r.mode === 'local');
  }

  // Applying into a non-private store is refused.
  {
    const { store, calls } = fakeStore('public');
    let threw = false;
    try {
      await migrateFiles({ apply: true }, store);
    } catch {
      threw = true;
    }
    ok('apply refused when the store is not private', threw && calls.upload === 0 && calls.writes === 0);
  }

  // Apply in small batches; a second full run finds nothing; old files never deleted.
  {
    const { store, calls, db, log } = fakeStore('private');
    const first = await migrateFiles({ apply: true, limit: 2 }, store);
    ok('apply processes one small batch', first.rows.length === 2 && first.remaining === 4);
    let rounds = 1;
    let last = first;
    while (last.remaining > 0 && rounds < 10) {
      last = await migrateFiles({ apply: true, limit: 2 }, store);
      rounds++;
    }
    ok('batches finish the work', last.remaining === 0 && rounds === 3);
    const again = await migrateFiles({ apply: true }, store);
    ok('idempotent: a second run has nothing to do', again.rows.length === 0 && again.remaining === 0);
    ok('records now point at the private store', db.assets.filter((a) => !a.generated).every((a) => a.uri.includes('.private.')) && db.knowledge[0].fileUrl.includes('.private.') && db.leads[0].pdfUrl.includes('.private.'));
    ok('generated cache record removed, transcript cache cleared', !db.assets.some((a) => a.id === 'g1') && db.convs[0].transcriptPdfUrl === '');
    ok('old files are never deleted (no file deletion at all)', calls.deleteFile === 0 && calls.removeRecord === 1);
    ok('every obsolete old file is on the private move list', log.length === 6 && log.every((e) => e.oldUrl.includes('.public.') || e.oldUrl.startsWith('/uploads/')));
    ok('copied files are listed with their new location', log.filter((e) => e.action === 'copy').length === 4 && log.filter((e) => e.action === 'copy').every((e) => Boolean(e.newUrl?.includes('.private.'))));
    ok('the private-store file is not listed', !log.some((e) => e.recordId === 'a2'));
  }

  // Batch size is capped at 50 per call, whatever limit is asked for.
  {
    const { store, db } = fakeStore('private');
    db.assets = Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, uri: PUB(`x${i}.pdf`), generated: false, mimeType: 'application/pdf', originalFilename: null }));
    db.knowledge = [];
    db.leads = [];
    db.convs = [];
    const r = await migrateFiles({ apply: true, limit: 500 }, store);
    ok('batch size capped at 50', r.rows.length === 50 && r.remaining === 10);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
