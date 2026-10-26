/**
 * Unit tests for the confidentiality reply checks (no network).
 *
 *   npx tsx evals/test-reply-checks.ts
 */
import { inspectConversationReply, inspectReply } from './lib/replyChecks';

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
expect('evidence denial is a note, not a flag', 'None of the evidence I can pull up points to a Paramount case tied to Bykea.', 0, 1);
expect('nothing-makes-client denial is a note', 'Nothing in that history makes Bykea a Paramount client, and it never identifies an anonymized case.', 0, 1);
expect('case-from-employer denial is a note', "I don't have an approved Paramount case from Bykea or tied to that employment.", 0, 1);
expect('rather-than-connected denial is a note', "I'll check mobility more broadly, rather than a case connected to Ali's time at Bykea.", 0, 1);
expect('case denial cannot mask delivery wording', "I don't have a Paramount case, but we built pricing for Bykea.", 1);
expect('listed client name flagged', 'We built this for Acme Widgets last year.', 1, 0, ['Acme Widgets']);
expect('client list is case-insensitive', 'acme widgets was happy.', 1, 0, ['Acme Widgets']);

// Review cases (PR #2): explicit or implied client framing must be flagged,
// founder background and denials must not. 3 + 5 own variants; 4 + 5 own variants.
const MUST_FLAG = [
  'We previously built a support chatbot for Jazz, our client.',
  'Our client Bykea has a strong background in ride-hailing.',
  'We delivered this for Daraz, as listed on our LinkedIn.',
  'Jazz Cash, our client, saw a 30% lift in conversions.',
  'As a client, Toptal asked us to build a matching engine.',
  'We worked with Gratia on their analytics platform.',
  'Catalant hired Paramount to build a pricing model.',
  'Our career highlights include the Daraz recommendation engine we built for them.',
];
const MUST_NOT_FLAG = [
  'Before founding Paramount, Ali worked at Daraz.',
  'Ali previously led AI products at Jazz.',
  "Jazz is on Ali's personal résumé, where he worked on a support assistant.",
  'Bykea is not a Paramount client.',
  'Marty worked at Catalant as Head of Expert Experience.',
  'Prior to founding Paramount, Ali spent two years at Bykea.',
  "Ali's role at Toptal was as an independent contractor.",
  'Gratia is not a client of Paramount.',
  'Our founder previously worked at Daraz on search ranking.',
];
function probe(name: string, reply: string, wantFlag: boolean) {
  const { flags } = inspectReply(reply);
  if ((flags.length > 0) === wantFlag) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}: ${flags.length} flags`, flags);
    failed++;
  }
}
for (const s of MUST_FLAG) probe(`review: flagged: ${s}`, s, true);
for (const s of MUST_NOT_FLAG) probe(`review: not flagged: ${s}`, s, false);
// Stricter than the filter: an unframed mention is flagged (the filter keeps it).
probe('neutral mention is flagged by the stricter probe', 'Bykea is a ride-hailing company.', true);
probe('he/she alone is not founder framing for the probe', 'He worked with Jazz on a chatbot.', true);

const employerCase = inspectConversationReply(
  'Bykea is not a Paramount client. See the case [[case:abc]].',
  'chat',
);
probe('former employer plus any case tag is flagged', 'Bykea was our client [[case:abc]].', true);
if (!employerCase.flags.some((flag) => flag.includes('case citation'))) failed++;
else passed++;

for (const [name, text, channel] of [
  ['old fallback', "I don't have that detail on file", 'chat'],
  ['labelled starter', 'Straight answer: yes.', 'chat'],
  ['voice markdown', '- First item', 'voice'],
] as const) {
  const result = inspectConversationReply(text, channel);
  if (result.flags.length > 0) passed++;
  else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
