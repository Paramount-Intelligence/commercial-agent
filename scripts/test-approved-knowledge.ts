/**
 * Unit tests for approved knowledge (no database, no API calls): chunker and
 * headers, manifest and hold filtering, the draft scan, the query-embedding
 * cache, floors and the per-doc cap, attribution wording, the client-name
 * rule, the bundle and the import route's gate and dry run.
 *
 *   npx tsx scripts/test-approved-knowledge.ts
 */
import { buildChunks, buildHeader, sections, windows, WINDOW_TOKENS } from '../lib/knowledge/approved/chunk';
import { anonymisedFromSubtitle, attributionWording, ATTRIBUTION_RULES_PROMPT, displayClient } from '../lib/knowledge/approved/attribution';
import { employerNames, formerEmployersFrom } from '../lib/knowledge/approved/employers';
import { scanDoc } from '../lib/knowledge/approved/scan';
import { docFromDraft, hashDoc, parseConfidentialNames, planKnowledge, splitFrontMatter, stripSourceCites, type Manifest } from '../lib/knowledge/approved/manifest';
import { checkBundle, decodeVector, encodeVector, makeBundle } from '../lib/knowledge/approved/bundle';
import { importKnowledgeBundle, knowledgeImportEnabled } from '../lib/knowledge/approved/importBundle';
import { loadKnowledge, type KnowledgeStore } from '../lib/knowledge/approved/store';
import { knowledgeSource } from '../lib/knowledge/approved/catalog';
import { CARD_SIMILARITY, rankChunks, MAX_CHUNKS_PER_DOC, SIMILARITY_FLOOR, TOP_CHUNKS, type ChunkHit } from '../lib/knowledge/approved/retrieve';
import { buildTurnEvidence } from '../lib/knowledge/approved/context';
import { onepagerInputFromDoc } from '../lib/knowledge/approved/onepager';
import { checkCaseAttribution } from '../lib/knowledge/approved/attributionCheck';
import { validateSrcGrounding } from '../lib/agent/srcGrounding';
import { createQueryEmbedder, LruCache, normaliseQuery, QUERY_EMBED_ATTEMPTS, QUERY_EMBED_CEILING_MS } from '../lib/retrieval/queryEmbedding';
import { filterBuyerText } from '../lib/safety/buyerOutput';
import type { ActiveDoc } from '../lib/knowledge/approved/catalog';
import type { KnowledgeDocInput } from '../lib/knowledge/approved/types';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
    failed++;
  }
}

const words = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

const draft = (fm: string, body: string) => `---\n${fm}\n---\n${body}\n`;
const caseFm = (id: string, extra = '') =>
  `id: ${id}\ntype: case\ntitle: Case ${id}\nsubtitle: Something useful for a PE-backed field service SaaS company\nindustry: Field service\npe_backed: true\ntech: [AWS Lambda, Bedrock]\nattribution_review: required (channel inferred: resume says so)\n${extra}`;

async function main() {
  // ——— Chunker and header ———
  {
    const text = words(800);
    const w = windows(text);
    const size = WINDOW_TOKENS * 4;
    ok('windows are ~300 tokens (≤1200 chars)', w.every(([a, b]) => b - a <= size));
    ok('windows start and end on whitespace', w.every(([a, b]) => (a === 0 || text[a - 1] === ' ') && (b === text.length || text[b] === ' ')));
    const overlaps = w.slice(1).map(([a], i) => w[i][1] - a);
    ok('consecutive windows overlap by ~15%', overlaps.every((o) => o > size * 0.08 && o < size * 0.25), overlaps.join(','));
    ok('windows cover the whole text', w[0][0] === 0 && w[w.length - 1][1] === text.length);
    const secs = sections('# Title\n\nIntro text\n\n## Challenge\nHard problem\n\n## Results\nGood results');
    ok('sections split on ## and drop the # title', secs.length === 3 && secs[0].heading === 'Overview' && secs[1].heading === 'Challenge' && !secs[0].text.includes('Title'));
    const header = buildHeader({ title: 'T', type: 'case', metadata: { industry: 'Retail' } }, 'Results');
    ok('header names document, type, industry and section', header === 'Document: T\nType: case\nIndustry: Retail\nSection: Results');
    ok('header omits a missing industry', !buildHeader({ title: 'T', type: 'faq', metadata: {} }, 'Overview').includes('Industry'));
    const chunks = buildChunks({ title: 'T', type: 'case', metadata: {}, body: `## Overview\n${words(250, 'a')}\n\n## Results\n${words(250, 'b')}` });
    ok('chunk header names the section the window starts in', chunks[0].header.endsWith('Section: Overview') && chunks.at(-1)!.header.endsWith('Section: Results'));
    ok('chunks are numbered and carry a token count', chunks.every((c, i) => c.ordinal === i && c.tokenCount > 0));
  }

  // ——— Front matter, cites, manifest and hold filtering ———
  {
    const { fm, body } = splitFrontMatter(draft(caseFm('c1'), '# Case c1\n\n## Overview\nText (Deck p6) here.\n\n(Library L42, Client Benefits)\n'));
    ok('loose front matter with ": " in a value parses', typeof fm.attribution_review === 'string' && fm.pe_backed === true);
    ok('source cites are stripped from the body', stripSourceCites(body) === '# Case c1\n\n## Overview\nText here.');
    const manifest: Manifest = {
      version: 1,
      entries: [
        { id: 'c1', path: 'c1.md', type: 'case', attribution: 'paramount-delivery-outcome', status: 'draft', client_name: 'Acmecorp', client_name_approved: false },
        { id: 'c2', path: 'c2.md', type: 'case', attribution: 'ali-personal-contract', status: 'hold' },
        { id: 'fb', path: 'fb.md', type: 'founder-background', attribution: 'ali-prior-employment', status: 'draft' },
        { id: 'bad', path: 'bad.md', type: 'company', attribution: 'paramount-positioning', status: 'draft' },
        { id: 'wrongid', path: 'w.md', type: 'faq', attribution: 'paramount-positioning', status: 'draft' },
      ],
    };
    const files: Record<string, string> = {
      'c1.md': draft(caseFm('c1'), '## Overview\nWe built it.'),
      'c2.md': draft(caseFm('c2'), '## Overview\nHeld.'),
      'fb.md': draft('id: fb\ntype: founder-background\ntitle: Background\nemployer: Jazz (part of VEON), including JazzCash', 'Before founding Paramount, Ali worked at Jazz.'),
      'bad.md': draft('id: bad\ntype: company\ntitle: Bad', 'Our client Jazz loved it. Call 555-123-4567 or bob@example.com. Acmecorp too.'),
      'w.md': draft('id: other\ntype: faq\ntitle: W', 'Fine.'),
    };
    const plan = planKnowledge(manifest, (p) => files[p], ['Secretprog']);
    ok('held entries are skipped, never loaded', plan.held.includes('c2') && !plan.docs.some((d) => d.id === 'c2'));
    ok('clean drafts are loaded', plan.docs.map((d) => d.id).sort().join(',') === 'c1,fb');
    const bad = plan.refused.find((r) => r.id === 'bad');
    const kinds = bad && typeof bad.problems !== 'string' ? new Set(bad.problems.map((p) => p.kind)) : new Set();
    ok('scan refuses a former employer, a client name and personal contacts outside founder context', kinds.has('former-employer') && kinds.has('confidential-name') && kinds.has('personal-contact'));
    ok('a draft whose id differs from the manifest is refused', plan.refused.some((r) => r.id === 'wrongid'));
    ok('employers come from founder-background docs', plan.formerEmployers.join(',') === 'JazzCash,Jazz,VEON');
    ok('confidential names include unapproved manifest client names', plan.confidentialNames.includes('Acmecorp') && plan.confidentialNames.includes('Secretprog'));
    const c1 = plan.docs.find((d) => d.id === 'c1')!;
    ok('metadata carries subtitle, industry, PE flag and tech', c1.metadata.peBacked === true && c1.metadata.tech?.length === 2 && c1.metadata.industry === 'Field service');
    ok('client name is kept but not approved', c1.clientName === 'Acmecorp' && c1.clientNameApproved === false);
    ok('content hash is stable and changes with the body', hashDoc(c1) === c1.contentHash && hashDoc({ ...c1, body: c1.body + '!' }) !== c1.contentHash);
    ok('confidential-names.yaml accepts strings or {name}', parseConfidentialNames('names:\n  - Alpha Co\n  - {name: Beta Inc}\n  - ab').join('|') === 'Alpha Co|Beta Inc');
    ok('employers allowed in founder-attributed cases', scanDoc({ id: 'x', type: 'case', attribution: 'ali-prior-employment', title: 'x', body: 'Ali worked at Bykea.' }, { confidentialNames: [], formerEmployers: ['Bykea'] }).length === 0);
    ok('employers refused in a Paramount case', scanDoc({ id: 'x', type: 'case', attribution: 'paramount-delivery-outcome', title: 'x', body: 'Built for Bykea.' }, { confidentialNames: [], formerEmployers: ['Bykea'] }).length === 1);
    ok('approved contacts pass the scan', scanDoc({ id: 'x', type: 'contact', attribution: 'paramount-positioning', title: 'x', body: 'ali@paramountintelligence.co or 443.494.9144' }, { confidentialNames: [], formerEmployers: [] }).length === 0);
  }

  // ——— Employer names ———
  ok('employer field "Jazz (part of VEON), including JazzCash"', employerNames('Jazz (part of VEON), including JazzCash').join(',') === 'Jazz,VEON,JazzCash');
  ok('employer field "Daraz (Alibaba-backed e-commerce marketplace)"', employerNames('Daraz (Alibaba-backed e-commerce marketplace)').join(',') === 'Daraz,Alibaba');
  ok('employer field "Gratia (AI-powered consulting platform)" ignores AI', employerNames('Gratia (AI-powered consulting platform)').join(',') === 'Gratia');
  ok('"Bore and Bore" stays one name', employerNames('Bore and Bore').join(',') === 'Bore and Bore');
  ok('merged list is unique, longest first', formerEmployersFrom(['Jazz', 'JazzCash', 'Jazz']).join(',') === 'JazzCash,Jazz');

  // ——— Buyer filter with the knowledge's employer list ———
  {
    const list = ['Bykea', 'Toptal'];
    ok('approved list: a former employer as a client is filtered', !/bykea/i.test(filterBuyerText('Our client Bykea saw great results.', { formerEmployers: list })));
    ok('approved list: founder background stays', /Bykea/.test(filterBuyerText('Before founding Paramount, Ali worked at Bykea as a data scientist.', { formerEmployers: list })));
    ok('approved list: speech-to-text variants still match', !/vaikea/i.test(filterBuyerText('Our client Vaikea saw great results.', { formerEmployers: list })));
  }

  // ——— Query-embedding cache and retry ceiling ———
  {
    ok('query normalisation', normaliseQuery('  Do you build AI AGENTS?  ') === 'do you build ai agents');
    const lru = new LruCache<number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    ok('LRU evicts the least recently used', lru.get('b') === undefined && lru.get('a') === 1 && lru.size === 2);
    let calls = 0;
    const e = createQueryEmbedder({ embedOnce: async () => (calls++, [1, 2, 3]) });
    await e.embedQuery('Do you build agents?');
    const second = await e.embedQuery('do you build agents');
    ok('same question (normalised) is served from cache', calls === 1 && second.cached);
    let attempts = 0;
    const flaky = createQueryEmbedder({ embedOnce: async () => { attempts++; throw Object.assign(new Error('rate'), { status: 429 }); } });
    const err = await flaky.embedQuery('x').catch((x) => x);
    ok(`at most ${QUERY_EMBED_ATTEMPTS} attempts on a retryable error`, attempts === QUERY_EMBED_ATTEMPTS && err instanceof Error);
    let fatal = 0;
    const bad = createQueryEmbedder({ embedOnce: async () => { fatal++; throw Object.assign(new Error('bad'), { status: 400 }); } });
    await bad.embedQuery('x').catch(() => {});
    ok('no retry on a 400', fatal === 1);
    let now = 0;
    let slowCalls = 0;
    const timeouts: number[] = [];
    const slow = createQueryEmbedder({
      now: () => now,
      embedOnce: async (_t, timeoutMs) => {
        slowCalls++;
        timeouts.push(timeoutMs);
        now += QUERY_EMBED_CEILING_MS; // the attempt used the whole budget
        throw new Error('timeout');
      },
    });
    await slow.embedQuery('y').catch(() => {});
    ok(`the ${QUERY_EMBED_CEILING_MS / 1000} s ceiling bounds all attempts`, slowCalls === 1 && timeouts[0] === QUERY_EMBED_CEILING_MS);
  }

  // ——— Floors, per-doc cap, tie-break ———
  {
    const hit = (docId: string, sim: number, extra: Partial<ChunkHit> = {}): ChunkHit => ({
      chunkId: `${docId}:${sim}`, docId, type: 'case', title: docId, attribution: 'paramount-delivery-outcome', metadata: {}, header: '', content: docId, sim, ...extra,
    });
    const r = rankChunks('q', [hit('a', 0.6), hit('a', 0.59), hit('a', 0.58), hit('b', 0.5), hit('c', 0.24), hit('d', 0.45), hit('e', 0.44), hit('f', 0.43)]);
    ok(`floor ${SIMILARITY_FLOOR} drops weak matches`, !r.rankedDocIds.includes('c'));
    ok(`at most ${MAX_CHUNKS_PER_DOC} chunks per doc`, r.chunks.filter((c) => c.docId === 'a').length === MAX_CHUNKS_PER_DOC);
    ok(`top ${TOP_CHUNKS} chunks`, r.chunks.length === TOP_CHUNKS);
    ok('no-match question returns nothing', rankChunks('q', [hit('x', 0.2), hit('y', 0.1)]).chunks.length === 0);
    const tie = rankChunks('Lambda on AWS for a PE-backed company', [
      hit('plain', 0.5052),
      hit('tech', 0.5011, { metadata: { tech: ['AWS Lambda', 'Lambda'], peBacked: true } }),
    ]);
    ok('tech and PE signals break a near-tie', tie.rankedDocIds[0] === 'tech');
    const notTie = rankChunks('Lambda', [hit('plain', 0.6), hit('tech', 0.5, { metadata: { tech: ['Lambda'] } })]);
    ok('signals never beat a clearly better match', notTie.rankedDocIds[0] === 'plain');
  }

  // ——— Attribution wording and client names ———
  {
    ok('delivery outcome = "we built"', attributionWording('paramount-delivery-outcome').rule.includes('we built'));
    ok('personal contract = "our founder led", never Paramount\'s client', /our founder led/.test(attributionWording('ali-personal-contract').rule) && /Never call the client "Paramount's client"/.test(attributionWording('ali-personal-contract').rule));
    ok('prior employment = "before founding Paramount, Ali worked at"', /before founding Paramount, Ali worked at/.test(attributionWording('ali-prior-employment').rule) && /Never present it as a Paramount case/.test(attributionWording('ali-prior-employment').rule));
    ok('prompt lists all three rules', ['paramount-delivery-outcome', 'ali-personal-contract', 'ali-prior-employment'].every((a) => ATTRIBUTION_RULES_PROMPT.includes(a)));
    ok('client name hidden unless approved', displayClient({ clientName: 'Acmecorp', clientNameApproved: false, anonymised: 'a SaaS company' }) === 'a SaaS company');
    ok('client name shown when approved', displayClient({ clientName: 'Acmecorp', clientNameApproved: true }) === 'Acmecorp');
    ok('no anonymised text → generic', displayClient({ clientName: 'Acmecorp', clientNameApproved: false }) === 'a confidential client');
    ok('anonymised client from the subtitle', anonymisedFromSubtitle('Production AI service for a PE-backed field service SaaS company (founder-led)') === 'a PE-backed field service SaaS company');
  }

  // ——— Context block ———
  {
    const doc = (id: string, type: string, attribution: ActiveDoc['attribution']): ActiveDoc => ({
      id, type, title: `T ${id}`, attribution, clientName: 'Acmecorp', clientNameApproved: false, metadata: { subtitle: 'X for a regional bank' }, body: '',
    });
    const docs = new Map([
      ['c', doc('c', 'case', 'ali-prior-employment')],
      ['p', doc('p', 'case', 'ali-personal-contract')],
      ['d', doc('d', 'case', 'paramount-delivery-outcome')],
      ['s', doc('s', 'faq', 'paramount-positioning')],
    ]);
    const ev = buildTurnEvidence(
      [
        { chunkId: '1', docId: 'c', type: 'case', title: '', attribution: 'ali-prior-employment', metadata: {}, header: '', content: 'case text', sim: 0.6 },
        { chunkId: '2', docId: 's', type: 'faq', title: '', attribution: 'paramount-positioning', metadata: {}, header: '', content: 'faq text', sim: 0.5 },
      ],
      docs,
    );
    ok('cases are cited as [[case:ID]], other docs as [[src:ID]]', ev.block.includes('[[case:c]]') && ev.block.includes('[[src:s]]') && ev.caseIds.join() === 'c' && ev.src[0].id === 's');
    ok('prior-employment work: founder background, no client line', ev.block.includes('FOUNDER BACKGROUND') && ev.block.includes('before founding Paramount') && !/Client:/.test(ev.block));
    const hit = (docId: string, a: ActiveDoc['attribution']) => ({ chunkId: docId, docId, type: 'case', title: '', attribution: a, metadata: {}, header: '', content: 'x', sim: 0.6 });
    const ev2 = buildTurnEvidence([hit('p', 'ali-personal-contract'), hit('d', 'paramount-delivery-outcome')], docs);
    ok("founder-led work: client marked as the founder's, not Paramount's", ev2.block.includes("Client: a regional bank (the founder's own contract client, not a Paramount client)"));
    ok('Paramount case: anonymised client, never the real name', ev2.block.includes('PARAMOUNT CASE') && ev2.block.includes('Client: a regional bank\n') && !ev2.block.includes('Acmecorp'));
    const ev3 = buildTurnEvidence([{ ...hit('d', 'paramount-delivery-outcome'), sim: 0.62 }, { ...hit('p', 'ali-personal-contract'), sim: 0.33 }], docs);
    ok(`card only for a strong match (≥ ${CARD_SIMILARITY})`, ev3.cardIds.join() === 'd' && ev3.caseIds.sort().join() === 'd,p');
    ok('a weaker case (above the floor) still goes to the model as context', ev3.block.includes('[[case:p]]'));
    ok('no match → plain "nothing matches" block, no ids', buildTurnEvidence([], docs).block.includes('nothing in the approved knowledge matches') && buildTurnEvidence([], docs).caseIds.length === 0);
  }

  // ——— Attribution check on replies ———
  {
    const a = new Map<string, 'ali-prior-employment' | 'ali-personal-contract' | 'paramount-delivery-outcome'>([
      ['prior', 'ali-prior-employment'],
      ['contract', 'ali-personal-contract'],
      ['ours', 'paramount-delivery-outcome'],
    ]);
    const bad = (t: string) => !checkCaseAttribution(t, a).ok;
    ok('flags founder background presented as a Paramount case', bad('Separately, Paramount does have an anonymized case in this space, a **Dynamic Pricing Engine** [[case:prior]], built for a confidential client.'));
    ok('flags "we built" on founder background', bad('We built a dynamic pricing engine for a ride-hailing platform [[case:prior]].'));
    ok('flags "our client" on founder-led work', bad('Our founder led a support copilot for our client, a software company [[case:contract]].'));
    ok('flags "we built" on founder-led work', bad('We built a support copilot for a PE-backed software company [[case:contract]].'));
    ok('allows "before founding Paramount, Ali ... built"', !bad('Before founding Paramount, Ali worked as a data scientist at a ride-hailing company, where he built a dynamic pricing engine [[case:prior]].'));
    ok('allows "our founder led"', !bad('Our founder led a support copilot build for a PE-backed software company [[case:contract]].'));
    ok('allows a denial', !bad('That was not a Paramount client engagement [[case:prior]].'));
    ok('Paramount cases may say "we built"', !bad('We built an AI field intelligence platform for a PE-backed company [[case:ours]].'));
  }

  // ——— De-anonymisation rule: a prior-employment case may name its own employer ———
  {
    const bridge = 'Before founding Paramount, Ali built that pricing engine at Bykea, the same company [[case:prior]].';
    const run = (text: string, own?: Map<string, string[]>, cited = ['prior']) =>
      validateSrcGrounding({
        replyText: text,
        retrievedSrc: new Map(),
        caseRetrievedIds: new Set(cited),
        validCaseIdsInReply: new Set(cited),
        gateActive: false,
        restrictedEmployers: ['Bykea', 'Jazz'],
        ownEmployerCases: own,
      });
    const legacy = run(bridge);
    ok('without the map the bridge rule fires (legacy behaviour)', !legacy.ok && legacy.rule === 'deanon_employer_case_bridge');
    ok('a prior-employment case may name its own employer', run(bridge, new Map([['prior', ['Bykea']]])).ok);
    const other = run(bridge, new Map([['prior', ['Jazz']]]));
    ok('naming a different employer still fires', !other.ok && other.rule === 'deanon_employer_case_bridge');
    const contract = run(bridge.replace('[[case:prior]]', '[[case:contract]]'), new Map([['prior', ['Bykea']]]), ['contract']);
    ok('founder-led (contract) cases keep the full rule', !contract.ok && contract.rule === 'deanon_employer_case_bridge');
  }

  // ——— One-pager input from a draft ———
  {
    const input = onepagerInputFromDoc({ id: 'c', title: 'T', body: '## Overview\nO\n\n## Challenge\nC\n\n## Solution\nS\n\n## Results\nR', metadata: { tech: ['AWS'], industry: 'Retail' } });
    ok('one-pager input from draft sections, no client name', input.summary === 'O' && input.challenge === 'C' && input.solution === 'S' && input.results === 'R' && input.clientName === null);
  }

  // ——— Switch, bundle, load and import ———
  {
    ok('KNOWLEDGE_SOURCE defaults to legacy', knowledgeSource({}) === 'legacy' && knowledgeSource({ KNOWLEDGE_SOURCE: 'approved' }) === 'approved' && knowledgeSource({ KNOWLEDGE_SOURCE: 'yes' }) === 'legacy');
    ok('import route gate off by default', !knowledgeImportEnabled({}) && !knowledgeImportEnabled({ KNOWLEDGE_IMPORT_ENABLED: '1' }) && knowledgeImportEnabled({ KNOWLEDGE_IMPORT_ENABLED: 'true' }));
    const v = [0.25, -0.5, 1];
    ok('embeddings round-trip through base64 float32', decodeVector(encodeVector(v)).every((x, i) => Math.abs(x - v[i]) < 1e-6));

    const docA = docFromDraft({ id: 'a', path: '', type: 'faq', attribution: 'paramount-positioning', status: 'draft' }, { title: 'A' }, `## Q\n${words(400)}`);
    const docB = docFromDraft({ id: 'b', path: '', type: 'company', attribution: 'paramount-positioning', status: 'draft' }, { title: 'B' }, 'Short.');
    const rows = new Map<string, { contentHash: string; chunkCount: number; status: string }>();
    const writes: string[] = [];
    const store: KnowledgeStore = {
      existingHashes: async () => new Map([...rows].filter(([, r]) => r.status !== 'retired').map(([id, r]) => [id, r])),
      upsertDoc: async (doc, chunks) => {
        writes.push(doc.id);
        const prev = rows.get(doc.id);
        rows.set(doc.id, { contentHash: doc.contentHash, chunkCount: chunks ? chunks.length : (prev?.chunkCount ?? 0), status: doc.status });
      },
      retireMissing: async (keep) => {
        let n = 0;
        for (const [id, r] of rows) if (!keep.includes(id) && r.status !== 'retired') (r.status = 'retired'), n++;
        return n;
      },
      setSetting: async () => {},
    };
    let embedded = 0;
    const embedder = async (_d: KnowledgeDocInput, chunks: { content: string }[]) => (embedded += chunks.length, chunks.map(() => [0.1, 0.2]));
    const input = { docs: [docA, docB], confidentialNames: [], formerEmployers: [] };
    const dry = await loadKnowledge(input, { apply: false, embedder }, store);
    ok('ingest dry run writes and embeds nothing', !dry.apply && writes.length === 0 && embedded === 0 && dry.embeddedDocs === 2);
    await loadKnowledge(input, { apply: true, embedder }, store);
    const firstEmbedded = embedded;
    const again = await loadKnowledge(input, { apply: true, embedder }, store);
    ok('second ingest re-embeds nothing (idempotent)', again.unchanged === 2 && again.embeddedChunks === 0 && embedded === firstEmbedded);
    const changed = await loadKnowledge({ ...input, docs: [{ ...docA, body: docA.body + ' more', contentHash: hashDoc({ ...docA, body: docA.body + ' more' }) }, docB] }, { apply: true, embedder }, store);
    ok('only the changed doc is re-embedded', changed.embeddedDocs === 1 && changed.unchanged === 1);
    const retired = await loadKnowledge({ ...input, docs: [docB] }, { apply: true, embedder }, store);
    ok('a doc no longer in the set is retired, not deleted', retired.retired === 1 && rows.get('a')?.status === 'retired');

    // Import: bundle with embeddings, all-or-nothing, dry run by default.
    const toBundleDoc = (d: KnowledgeDocInput) => ({ ...d, chunks: buildChunks(d).map((c) => ({ ordinal: c.ordinal, embedding: encodeVector([0.1, 0.2]) })) });
    const bundle = makeBundle({ confidentialNames: ['Secretprog'], formerEmployers: ['Bykea'], docs: [toBundleDoc(docA), toBundleDoc(docB)] });
    rows.clear();
    writes.length = 0;
    const importDry = await importKnowledgeBundle(bundle, { apply: false }, store);
    ok('import dry run: counts only, nothing written', importDry.ok && !importDry.apply && importDry.embeddedDocs === 2 && writes.length === 0);
    const importApply = await importKnowledgeBundle(bundle, { apply: true }, store);
    ok('import apply writes the docs', importApply.ok && importApply.apply && rows.size === 2);
    const importAgain = await importKnowledgeBundle(bundle, { apply: true }, store);
    ok('import is idempotent', importAgain.ok && importAgain.unchanged === 2 && importAgain.embeddedDocs === 0);
    ok('tampered bundle is refused (checksum)', !checkBundle({ ...bundle, formerEmployers: [] }).ok);
    const heldBundle = makeBundle({ confidentialNames: [], formerEmployers: [], docs: [{ ...toBundleDoc(docB), status: 'hold' }] });
    ok('a held doc in a bundle is refused', !checkBundle(heldBundle).ok);
    const leaky = { ...docB, body: 'Our client Bykea.', contentHash: hashDoc({ ...docB, body: 'Our client Bykea.' }) };
    writes.length = 0;
    const refused = await importKnowledgeBundle(makeBundle({ confidentialNames: [], formerEmployers: ['Bykea'], docs: [toBundleDoc(leaky)] }), { apply: true }, store);
    ok('import re-runs the scan and refuses the whole bundle', !refused.ok && refused.refused?.[0]?.kinds.includes('former-employer') === true && writes.length === 0);
  }

  // ——— Import route: 404 unless enabled ———
  {
    delete process.env.KNOWLEDGE_IMPORT_ENABLED;
    const { POST } = await import('../app/api/admin/knowledge/import/route');
    const res = await POST(new Request('http://x/api/admin/knowledge/import', { method: 'POST', body: '{}' }));
    ok('import route is 404 without KNOWLEDGE_IMPORT_ENABLED', res.status === 404);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
