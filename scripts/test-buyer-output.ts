/**
 * Unit tests for the buyer-output safety filter (no database).
 *
 *   npx tsx scripts/test-buyer-output.ts
 */
import { filterBuyerDocumentText, filterBuyerText } from '../lib/safety/buyerOutput';
import { envConfidentialNames } from '../lib/safety/clientNames';

let passed = 0;
let failed = 0;
function eq(name: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}\n   got:      ${JSON.stringify(actual)}\n   expected: ${JSON.stringify(expected)}`);
    failed++;
  }
}
function has(name: string, actual: string, needle: string | RegExp, want = true) {
  const hit = typeof needle === 'string' ? actual.includes(needle) : needle.test(actual);
  if (hit === want) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// Former employers presented as clients are replaced, every name and variant.
const variants: Array<[string, string]> = [
  ['Jazz', 'Jazz'],
  ['JazzCash', 'JazzCash'],
  ['Jazz Cash (spaced)', 'Jazz Cash'],
  ['Jazz-Cash (hyphen)', 'Jazz-Cash'],
  ['JAZZCASH (caps)', 'JAZZCASH'],
  ['VEON', 'VEON'],
  ['Mobilink', 'Mobilink'],
  ['Bykea', 'Bykea'],
  ['Bykea STT spelling', 'Baikeya'],
  ['Daraz', 'Daraz'],
  ['Daraz.pk', 'Daraz.pk'],
  ['Alibaba', 'Alibaba'],
  ['Toptal', 'Toptal'],
  ['Top-tal', 'Top-tal'],
  ['Gratia', 'Gratia'],
  ['Catalant', 'Catalant'],
  ['Bore and Bore', 'Bore and Bore'],
  ['Bore & Bore', 'Bore & Bore'],
];
for (const [label, name] of variants) {
  eq(`client framing replaced: ${label}`, filterBuyerText(`We built a pricing engine for ${name}.`), 'We built a pricing engine for a client.');
}
eq('"our client X" phrase replaced whole', filterBuyerText("Our client Bykea's riders loved it."), "A client's riders loved it.");
eq('possessive handled', filterBuyerText("We built Bykea's pricing engine as a client project."), "We built a client's pricing engine as a client project.");
eq('sentence start capitalised', filterBuyerText('Done. Bykea was our client on this.'), 'Done. A client on this.');
eq('case mode replaces any mention', filterBuyerText('A ride-hailing platform like Bykea in Pakistan.', { mode: 'case' }), 'A ride-hailing platform like a client in Pakistan.');

// Founder background and denials are allowed.
eq('founder background kept', filterBuyerText('Before Paramount, Ali worked at Bykea as a data scientist.'), 'Before Paramount, Ali worked at Bykea as a data scientist.');
eq('employment kept', filterBuyerText("Ali's role at Daraz covered pricing."), "Ali's role at Daraz covered pricing.");
eq('platform wording kept', filterBuyerText('Ali took contracts through Toptal for several years.'), 'Ali took contracts through Toptal for several years.');
eq('resume wording kept', filterBuyerText("Jazz is on Ali's personal résumé, where he worked on a customer support assistant."), "Jazz is on Ali's personal résumé, where he worked on a customer support assistant.");
eq('denial kept', filterBuyerText('Jazz is not a Paramount client.'), 'Jazz is not a Paramount client.');
eq('neutral mention kept', filterBuyerText('Bykea is a ride-hailing company.'), 'Bykea is a ride-hailing company.');
eq('mixed text: only the client sentence changes', filterBuyerText('Ali worked at Jazz. We delivered this project for Jazz.'), 'Ali worked at Jazz. We delivered this project for a client.');

// Word boundaries: no false hits inside other words.
eq('no hit inside a longer word', filterBuyerText('The jazzercise client is happy.'), 'The jazzercise client is happy.');
eq('ordinary text untouched', filterBuyerText('We worked with a PE-backed field service company.'), 'We worked with a PE-backed field service company.');

// Contacts.
eq('approved phone kept', filterBuyerText('Call Marty at 443.494.9144.'), 'Call Marty at 443.494.9144.');
has('other US phone removed', filterBuyerText('Call 605-555-0143 today.'), /605/, false);
has('international phone removed', filterBuyerText('Or +92 300 1234567.'), /1234567/, false);
eq('approved email kept', filterBuyerText('Email ali@paramountintelligence.co.'), 'Email ali@paramountintelligence.co.');
has('personal email removed', filterBuyerText('Email someone@gmail.com please.'), 'gmail', false);
eq('buyer own email allowed when passed', filterBuyerText('I will send it to pat@acme.com.', { allowedEmails: ['pat@acme.com'] }), 'I will send it to pat@acme.com.');
eq('numbers that are not phones kept', filterBuyerText('It handled 50,000–60,000 submissions a day across 12,374 forms.'), 'It handled 50,000–60,000 submissions a day across 12,374 forms.');

// Unapproved client names.
const names = [{ name: 'Acme Widgets' }, { name: 'Globex', replacement: 'an energy company' }];
eq('client name replaced', filterBuyerText('We built this for Acme Widgets.', { clientNames: names }), 'We built this for a client.');
eq('client name spacing variant', filterBuyerText('Acme  Widgets liked it.', { clientNames: names }), 'A client liked it.');
eq('client name case-insensitive', filterBuyerText('ACME WIDGETS again.', { clientNames: names }), 'A client again.');
eq('custom replacement used', filterBuyerText('Globex runs plants.', { clientNames: names }), 'an energy company runs plants.');

// Tokens: kept in chat (cards), removed in documents.
eq('chat keeps case tags', filterBuyerText('See the field case [[case:abc]].'), 'See the field case [[case:abc]].');
eq('document removes case and src tags', filterBuyerDocumentText('Founded 2025 [[src:x1]]. See [[case:abc]].'), 'Founded 2025. See.');
has('document removes malformed fragments', filterBuyerDocumentText('See [[case:abc] here.'), /\[|case:/, false);

// CONFIDENTIAL_NAMES env parsing.
eq('env names parsed', envConfidentialNames({ CONFIDENTIAL_NAMES: ' Foo Corp, ,Ba, Initech ' }).map((n) => n.name).join('|'), 'Foo Corp|Initech');

// Review cases (PR #2): explicit or implied client framing must be filtered,
// founder background and denials must pass. 3 + 5 own variants; 4 + 5 own variants.
const MUST_FILTER = [
  'We previously built a support chatbot for Jazz, our client.',
  'Our client Bykea has a strong background in ride-hailing.',
  'We delivered this for Daraz, as listed on our LinkedIn.',
  'Jazz Cash, our client, saw a 30% lift in conversions.',
  'As a client, Toptal asked us to build a matching engine.',
  'We worked with Gratia on their analytics platform.',
  'Catalant hired Paramount to build a pricing model.',
  'Our career highlights include the Daraz recommendation engine we built for them.',
];
const MUST_PASS = [
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
const EMPLOYER_RE = /jazz|veon|mobilink|b[iy]kea|daraz|alibaba|top[\s-]*tal|gratia|catalant|bore\s*(and|&)\s*bore/i;
for (const t of MUST_FILTER) has(`review: filtered: ${t}`, filterBuyerText(t), EMPLOYER_RE, false);
for (const t of MUST_PASS) eq(`review: kept: ${t}`, filterBuyerText(t), t);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
