/**
 * Pure tests for email header sanitization + OTP org-budget constants.
 *
 *   npx tsx scripts/test-email-hardening.ts
 */
import { sanitizeHeader, isEmailFormat } from '../lib/email/sanitize';
import {
  OTP_ORG_DISTINCT_EMAILS_PER_HOUR,
  OTP_ORG_SENDS_PER_HOUR,
} from '../lib/auth/otpEmailBudget';

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
  const scrubbed = sanitizeHeader('hello\r\nBcc: evil@x.com');
  check(
    'CRLF stripped from subject payload',
    !scrubbed.includes('\n') && !scrubbed.includes('\r') && scrubbed === 'hello Bcc: evil@x.com',
    scrubbed,
  );

  check(
    'control chars collapsed to spaces',
    sanitizeHeader('a\u0000b\u0007c') === 'a b c',
    sanitizeHeader('a\u0000b\u0007c'),
  );

  check(
    'normal name/topic untouched (aside from trim)',
    sanitizeHeader('  Ammar — ride-hailing  ') === 'Ammar — ride-hailing',
  );

  const injectedTopic = 'pricing\nCc: attacker@evil.com\nSubject: hijacked';
  const subject = `New lead: Ammar from Catalant — ${sanitizeHeader(injectedTopic).slice(0, 80)}`;
  check(
    'injected topic cannot open new header lines in subject',
    !subject.includes('\n') && !subject.includes('\r'),
    subject,
  );

  check('email format accepts normal address', isEmailFormat('user@example.com'));
  check('email format rejects bare word', !isEmailFormat('not-an-email'));
  check('email format rejects missing domain', !isEmailFormat('user@'));

  check('org OTP send cap is a sane hourly budget', OTP_ORG_SENDS_PER_HOUR === 20);
  check(
    'org distinct-email cap is below send cap',
    OTP_ORG_DISTINCT_EMAILS_PER_HOUR === 15 &&
      OTP_ORG_DISTINCT_EMAILS_PER_HOUR < OTP_ORG_SENDS_PER_HOUR,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
