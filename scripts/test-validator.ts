/**
 * Unit tests for anti-fabrication validator — no DB, no model.
 *
 *   npm run validator:test
 *   npx tsx scripts/test-validator.ts
 */
import {
  buildRegenerateFeedback,
  validateCitations,
} from '../lib/agent/validator';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function main() {
  // 1. two valid citations
  {
    const set = new Set(['id-a', 'id-b']);
    const r = validateCitations(
      'See [[case:id-a]] and also [[case:id-b]].',
      set,
    );
    check('1 valid pair → ok:true', r.ok === true);
  }

  // 2. one valid + one invalid
  {
    const set = new Set(['id-a']);
    const r = validateCitations(
      'Good [[case:id-a]] bad [[case:invented-99]].',
      set,
    );
    check(
      '2 mixed → ok:false, invalid=[invented-99]',
      r.ok === false &&
        !r.ok &&
        r.invalidIds.length === 1 &&
        r.invalidIds[0] === 'invented-99' &&
        r.validIds.includes('id-a'),
      r.ok === false ? `invalidIds=${JSON.stringify(r.invalidIds)}` : 'was ok',
    );
  }

  // 3. no citations
  {
    const r = validateCitations('A pitch with no case tags.', new Set(['id-a']));
    check('3 no citations → ok:true', r.ok === true);
  }

  // 4. cite when retrievedIds empty
  {
    const r = validateCitations('Claim [[case:ghost]].', new Set());
    const feedback =
      r.ok === false
        ? buildRegenerateFeedback(r.invalidIds, r.validIds)
        : '';
    check(
      '4 empty retrieved → ok:false + none feedback',
      r.ok === false &&
        !r.ok &&
        r.invalidIds.includes('ghost') &&
        feedback.includes(
          '(none — you have not retrieved any cases yet; call search_cases first)',
        ),
      r.ok === false ? feedback.slice(0, 120) : 'was ok',
    );
  }

  // 5. whitespace inside tag
  {
    const r = validateCitations('Trim works [[case: xyz ]].', new Set(['xyz']));
    check('5 whitespace [[case: xyz ]] → ok:true', r.ok === true);
  }

  // 6. duplicate valid citation
  {
    const r = validateCitations(
      'Again [[case:id-a]] and [[case:id-a]].',
      new Set(['id-a']),
    );
    check('6 duplicate valid → ok:true', r.ok === true);
  }

  console.log('\n' + '='.repeat(40));
  console.log(
    failed === 0
      ? `ALL PASSED (${passed})`
      : `FAILED ${failed} / ${passed + failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
