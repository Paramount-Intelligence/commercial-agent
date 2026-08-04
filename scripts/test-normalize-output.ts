/**
 * Tests for deterministic em/en-dash stripping in shipped Jackie output.
 *
 *   npm run normalize:test
 */
import { stripEmDashes } from '../lib/agent/normalizeOutput';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function main() {
  check('spaced em dash -> comma', stripEmDashes('a — b') === 'a, b', stripEmDashes('a — b'));
  check('bare em dash -> spaced hyphen', stripEmDashes('a—b') === 'a - b', stripEmDashes('a—b'));
  check('en dash range -> hyphen', stripEmDashes('10–30s') === '10-30s', stripEmDashes('10–30s'));

  const code = 'before ```const x = "a — b"``` after — done';
  const codeOut = stripEmDashes(code);
  check(
    'em dash inside fenced code preserved',
    codeOut.includes('```const x = "a — b"```') && codeOut.includes('after, done'),
    codeOut,
  );

  const inline = 'use `a—b` then go — on';
  const inlineOut = stripEmDashes(inline);
  check(
    'em dash inside inline code preserved',
    inlineOut.includes('`a—b`') && inlineOut.includes('go, on'),
    inlineOut,
  );

  const cite = 'See [[case:12]] — solid AWS work.';
  const citeOut = stripEmDashes(cite);
  check(
    'em dash near [[case:ID]] only strips prose',
    citeOut.includes('[[case:12]]') && citeOut === 'See [[case:12]], solid AWS work.',
    citeOut,
  );

  const url = 'Read https://example.com/a—b/path then ask — me.';
  const urlOut = stripEmDashes(url);
  check(
    'em dash inside URL preserved',
    urlOut.includes('https://example.com/a—b/path') && urlOut.includes('ask, me.'),
    urlOut,
  );

  const sample = [
    'Yes — Ali has SaaS automation experience.',
    'Rates in similar work were in the 10–30% reduction range.',
    'See [[case:42]] for the PE-backed platform.',
    'Snippet: ```sql SELECT 1 — noop``` and docs at https://docs.example.com/a–b.',
    'Happy to connect you with the team — whenever you are ready.',
  ].join('\n');
  const shipped = stripEmDashes(sample);
  // Strip protected spans, then assert remaining prose has no U+2014/U+2013
  const proseOnly = shipped
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/\[\[case:[^\]]+\]\]/g, ' ')
    .replace(/https?:\/\/[^\s]+/g, ' ');
  check(
    'full Jackie sample: zero em/en dashes in shipped prose',
    !proseOnly.includes('\u2014') && !proseOnly.includes('\u2013'),
    proseOnly,
  );
  check(
    'full sample still keeps citation + code + url spans intact',
    shipped.includes('[[case:42]]') &&
      shipped.includes('```sql SELECT 1 — noop```') &&
      shipped.includes('https://docs.example.com/a–b'),
    shipped,
  );

  console.log('\n' + '='.repeat(48));
  console.log(
    failed === 0
      ? `ALL PASSED (${passed})`
      : `FAILED ${failed} / ${passed + failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
