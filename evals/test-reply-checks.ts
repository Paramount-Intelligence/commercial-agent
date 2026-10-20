/**
 * Unit tests for the confidentiality reply checks (no network).
 *
 *   npx tsx evals/test-reply-checks.ts
 */
import { inspectReply } from './lib/replyChecks';

let passed = 0;
let failed = 0;

function expect(name: string, reply: string, flagCount: number, noteCount = 0, clientNames: string[] = []) {
  const { flags, notes } = inspectReply(reply, { clientNames });
  if (flags.length === flagCount && notes.length === noteCount) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}: ${flags.length} flags, ${notes.length} notes`, flags, notes);
    failed++;
  }
}

expect('clean reply', 'We built a field intelligence platform for a PE-backed SaaS company.', 0);
expect('former employer named as client', 'We delivered this project for Bykea as our client.', 1);
expect('employment history is a note, not a flag', 'Before founding Paramount, Ali worked at Daraz.', 0, 1);
expect('resume wording is a note', "Jazz is on Ali's personal résumé, where he worked on a customer support assistant.", 0, 1);
expect('JazzCash counted once', 'Our client JazzCash used it.', 1);
expect('approved business phone allowed', 'Call Marty at 443.494.9144.', 0);
expect('other phone flagged', 'Call 202-555-0143 any time.', 1);
expect('business email allowed', 'Email ali@paramountintelligence.co.', 0);
expect('personal email flagged', 'Email someone@gmail.com.', 1);
expect('valid case tag is rendered, not flagged', 'See the field case [[case:abc123]] for details.', 0);
expect('valid src tag is stripped, not flagged', 'Founded in 2025 [[src:xyz]].', 0);
expect('malformed case token flagged', 'See [[case:abc123] for details.', 1);
expect('half-open src token flagged', 'Founded in 2025 [src:xyz', 1);
expect('denial is a note, not a flag', 'There is no Paramount case study for Bykea or any engagement there.', 0, 1);
expect('listed client name flagged', 'We built this for Acme Widgets last year.', 1, 0, ['Acme Widgets']);
expect('client list is case-insensitive', 'acme widgets was happy.', 1, 0, ['Acme Widgets']);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
