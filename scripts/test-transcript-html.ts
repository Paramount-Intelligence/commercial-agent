/**
 * Unit test: transcript HTML (user and lead PDFs) carries no citation tokens,
 * no old assistant name, no file links and no confidential names.
 *
 *   npx tsx scripts/test-transcript-html.ts
 */
import { buildConversationTranscriptHtml } from '../lib/docgen/conversationTranscript';

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

for (const audience of ['user', 'lead'] as const) {
  const html = buildConversationTranscriptHtml({
    audience,
    leadName: 'Pat Buyer',
    leadEmail: 'pat@example.com',
    leadCompany: 'Example Co',
    topic: 'Field service AI',
    conversationId: 'conv1',
    generatedAt: new Date('2026-10-21T10:00:00Z'),
    turns: [
      { role: 'user', text: 'Have you worked in field service?', createdAt: new Date() },
      {
        role: 'assistant',
        text: 'Yes, our field case [[case:cmvabc123]] is one. Founded in 2025 [[src:xyz]]. We delivered a project for Bykea. Acme Widgets loved it. Call 605-555-0143.',
        createdAt: new Date(),
      },
    ],
    cases: [{ title: 'Pricing engine for Acme Widgets', url: 'https://www.paramountintelligence.co/case-studies/x' }],
    onepagers: [{ caseTitle: 'Field case', format: 'pdf' }],
    clientNames: [{ name: 'Acme Widgets' }],
  });
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/data:[^"]+/g, '');
  ok(`${audience}: no [[ tokens`, !/\[\[|case:cmv|src:xyz/.test(body));
  ok(`${audience}: no "Jackie"`, !/jackie/i.test(body));
  ok(`${audience}: assistant labelled Paramount Assistant`, body.includes('Paramount Assistant'));
  ok(`${audience}: no blob or uploads links`, !/vercel-storage|\/uploads\//.test(body));
  ok(`${audience}: former employer not shown as client`, !/Bykea/.test(body));
  ok(`${audience}: unapproved client name removed`, !/Acme Widgets/.test(body));
  ok(`${audience}: personal phone removed`, !/605-555-0143/.test(body));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
