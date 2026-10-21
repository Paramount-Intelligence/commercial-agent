/**
 * Unit tests for search_company_info exclusions (no database).
 *
 *   npx tsx scripts/test-company-exclusions.ts
 */
import {
  isExcludedChunk,
  isRetiredKnowledgeEntry,
  KB_SOURCE_URL,
  stripAgentNotes,
} from '../lib/knowledge/companyInfoExclusions';

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

const retired = new Set(['admin-knowledge://retired1']);
const kb = (heading: string, employer: string | null = null, sourceType = 'knowledge-base') => ({
  sourceType,
  sourceUrl: KB_SOURCE_URL,
  heading,
  employer,
});

ok('section 5 excluded', isExcludedChunk(kb('5. CONTEXT — Example Co', 'Example Co', 'founder-bio'), retired));
ok('section 12 excluded', isExcludedChunk(kb('12. CONFIDENTIALITY AND CLAIM CONTROL'), retired));
ok('section 13 excluded', isExcludedChunk(kb('13. APPROVED SOURCE REFERENCES'), retired));
ok('section 1 kept', !isExcludedChunk(kb('1. PARAMOUNT INTELLIGENCE — Company Identity'), retired));
ok('section 11 kept', !isExcludedChunk(kb('11. STANDARD CHATBOT ANSWERS — What does Paramount do?'), retired));
ok('founder employment history kept (Jazz)', !isExcludedChunk(kb('3. EXPERIENCE — Jazz, Part of VEON', 'Jazz, Part of VEON', 'founder-bio'), retired));
ok('founder employment history kept (Toptal)', !isExcludedChunk(kb('3. EXPERIENCE — Toptal', 'Toptal', 'founder-bio'), retired));
ok('Paramount role kept', !isExcludedChunk({ sourceType: 'founder-bio', sourceUrl: 'linkedin://x', heading: 'Role', employer: 'Paramount Intelligence' }, retired));
ok('founder row with a non-employer company excluded', isExcludedChunk({ sourceType: 'founder-bio', sourceUrl: 'linkedin://x', heading: 'Role', employer: 'Example Industrial Co' }, retired));
ok('founder row without employer kept', !isExcludedChunk({ sourceType: 'founder-bio', sourceUrl: 'linkedin://x', heading: '2. ALI — Identity', employer: null }, retired));
ok('retired admin knowledge excluded', isExcludedChunk({ sourceType: 'admin-knowledge', sourceUrl: 'admin-knowledge://retired1', heading: 'p1', employer: null }, retired));
ok('other admin knowledge kept', !isExcludedChunk({ sourceType: 'admin-knowledge', sourceUrl: 'admin-knowledge://other', heading: 'p1', employer: null }, retired));
ok('website section starting "5." kept', !isExcludedChunk({ sourceType: 'website', sourceUrl: 'https://site', heading: '5. Steps', employer: null }, retired));

const note =
  'Agent-facing note: These are approved public verification links (website, LinkedIn, profiles). External company filings (A, B) are context only. Prefer search_cases for Paramount delivery evidence.';
ok('references note stripped', stripAgentNotes(`Links:\nAli LinkedIn: x\n${note}`) === 'Links:\nAli LinkedIn: x');
ok('other content untouched', stripAgentNotes('Plain text.') === 'Plain text.');

ok('retired by id', isRetiredKnowledgeEntry({ id: 'cmrxnzw8s0001ia04yprtqij8' }));
ok('retired by file name', isRetiredKnowledgeEntry({ id: 'x', fileName: 'Paramount Intelligence - Company Overview - July 2026.pptx.pdf' }));
ok('current overview not retired', !isRetiredKnowledgeEntry({ id: 'y', fileName: 'Paramount Intelligence - Company Overview - Oct 2026.pdf' }));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
