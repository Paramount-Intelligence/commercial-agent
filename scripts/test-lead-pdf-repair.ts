/** Unit tests for the gated Lead PDF repair core: no database, files, or network. */
import {
  canRegenerateLeadPdf,
  repairLeadPdfs,
  savedLeadTopic,
  type LeadPdfRepairCandidate,
  type LeadPdfRepairStore,
} from '../lib/storage/repairLeadPdfs';

let passed = 0;
let failed = 0;
function ok(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const dead = (id: string, extra: Partial<LeadPdfRepairCandidate> = {}): LeadPdfRepairCandidate => ({
  id,
  conversationId: `conversation-${id}`,
  name: 'Test Buyer',
  email: 'buyer@example.com',
  company: 'Example Co',
  topic: 'An AI workflow',
  context: null,
  pdfUrl: `/uploads/leads/${id}.pdf`,
  ...extra,
});

function fakeStore(access: 'private' | 'public', initial: LeadPdfRepairCandidate[]) {
  let rows = initial.map((row) => ({ ...row }));
  const calls = { generated: 0, regenerated: 0, cleared: 0 };
  const logs: Array<{ action: string; oldUrl: string; newUrl: string | null }> = [];
  let failGenerate = false;
  const store: LeadPdfRepairStore = {
    candidates: async () => rows.filter((row) => row.pdfUrl.startsWith('/uploads/')).map((row) => ({ ...row })),
    generate: async () => {
      calls.generated++;
      if (failGenerate) throw new Error('render failed');
      return { url: 'https://private.example/leads/new.pdf', bytes: 123 };
    },
    commitRegenerated: async (row, newUrl) => {
      calls.regenerated++;
      rows.find((candidate) => candidate.id === row.id)!.pdfUrl = newUrl;
      logs.push({ action: 'regenerate-lead-pdf', oldUrl: row.pdfUrl, newUrl });
    },
    commitCleared: async (row) => {
      calls.cleared++;
      rows = rows.filter((candidate) => candidate.id !== row.id);
      logs.push({ action: 'clear-lead-pdf', oldUrl: row.pdfUrl, newUrl: null });
    },
    access: () => ({ access, kind: access === 'private' ? 'private-oidc' : 'local' }),
  };
  return { store, calls, logs, setFailGenerate: (value: boolean) => (failGenerate = value) };
}

async function main() {
  ok('saved topic is preferred', savedLeadTopic(dead('x', { context: 'Longer context' })) === 'An AI workflow');
  ok('context supports an older row without topic', savedLeadTopic(dead('x', { topic: null, context: 'Older context' })) === 'Older context');
  ok('missing topic and context cannot regenerate', !canRegenerateLeadPdf(dead('x', { topic: null, context: null })));

  {
    const { store, calls, logs } = fakeStore('public', [dead('regenerate'), dead('clear', { topic: null, context: null })]);
    const result = await repairLeadPdfs({}, store);
    ok('dry run is default and plans both outcomes', !result.apply && result.counts.plannedRegenerate === 1 && result.counts.plannedClear === 1);
    ok('dry run writes and renders nothing', calls.generated === 0 && calls.regenerated === 0 && calls.cleared === 0 && logs.length === 0);
    ok('dry run is allowed without private storage', result.mode === 'local' && result.remaining === 2);
  }

  {
    const { store, calls } = fakeStore('public', [dead('x')]);
    const error = await repairLeadPdfs({ apply: true }, store).catch((value) => value);
    ok('apply refuses non-private storage', error instanceof Error && calls.generated === 0);
  }

  {
    const { store, calls, logs } = fakeStore('private', [dead('regenerate'), dead('clear', { topic: null, context: null })]);
    const result = await repairLeadPdfs({ apply: true }, store);
    ok('apply regenerates when saved data is enough', result.counts.regenerated === 1 && calls.generated === 1 && calls.regenerated === 1);
    ok('apply clears an insufficient dead link', result.counts.cleared === 1 && calls.cleared === 1);
    ok('both applied outcomes are logged', logs.map((row) => row.action).sort().join(',') === 'clear-lead-pdf,regenerate-lead-pdf');
    ok('repair is idempotent', result.remaining === 0 && (await repairLeadPdfs({ apply: true }, store)).remaining === 0);
  }

  {
    const { store, calls, logs, setFailGenerate } = fakeStore('private', [dead('x')]);
    setFailGenerate(true);
    const result = await repairLeadPdfs({ apply: true }, store);
    ok('render failure keeps the old row for retry', result.counts.failed === 1 && result.remaining === 1 && calls.regenerated === 0 && logs.length === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
