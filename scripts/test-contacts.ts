/**
 * Pure tests for the Ali/Marty-approved contact reference + post-generation gate.
 *
 *   npm run contacts:test
 */
import { HARD_GUARDRAILS } from '../lib/agent/guardrails';
import {
  APPROVED_CONTACTS,
  APPROVED_CONTACTS_FALLBACK_ALI_PHONE,
  APPROVED_CONTACTS_PROMPT,
  isContactDiscussion,
  isLeadCaptureIntent,
  validateContactReply,
} from '../lib/agent/contacts';

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

function reasons(result: ReturnType<typeof validateContactReply>): string[] {
  return result.ok ? [] : result.reasons;
}

function main() {
  check(
    'prompt injected into hard guardrails',
    HARD_GUARDRAILS.includes(APPROVED_CONTACTS.ali.email) &&
      HARD_GUARDRAILS.includes(APPROVED_CONTACTS.marty.phone) &&
      HARD_GUARDRAILS.includes('NOT available for sharing'),
  );

  const reachAli = validateContactReply(
    'How can I reach Ali?',
    `You can reach Ali Azzam at ${APPROVED_CONTACTS.ali.email}. He's based outside the US.`,
  );
  check('reach Ali with approved email passes', reachAli.ok, reasons(reachAli).join(', '));

  const martyPhone = validateContactReply(
    "What's Marty's phone number?",
    `Marty's phone is ${APPROVED_CONTACTS.marty.phone}. He's in the Washington DC–Baltimore area.`,
  );
  check("Marty's phone passes", martyPhone.ok, reasons(martyPhone).join(', '));

  const aliPhoneDecline = validateContactReply(
    "What's Ali's phone number?",
    APPROVED_CONTACTS_FALLBACK_ALI_PHONE,
  );
  check(
    'Ali phone decline + email offer passes',
    aliPhoneDecline.ok,
    reasons(aliPhoneDecline).join(', '),
  );

  const aliPhoneLeak = validateContactReply(
    "What's Ali's phone number?",
    "Ali's phone is 555-123-4567 — you can call him anytime.",
  );
  check(
    'invented Ali phone is rejected',
    !aliPhoneLeak.ok,
    reasons(aliPhoneLeak).join(', '),
  );

  const team = validateContactReply(
    'How do I contact the team?',
    `Email Ali at ${APPROVED_CONTACTS.ali.email} or Marty at ${APPROVED_CONTACTS.marty.email}. Website: ${APPROVED_CONTACTS.website}.`,
  );
  check('team contact with both emails passes', team.ok, reasons(team).join(', '));

  const inventedEmail = validateContactReply(
    'How can I email Marty?',
    'Try marty.kaufman@gmail.com for a faster reply.',
  );
  check(
    'fabricated email is rejected',
    !inventedEmail.ok &&
      reasons(inventedEmail).some((r) => r.includes('unapproved email')),
    reasons(inventedEmail).join(', '),
  );

  check(
    'prompt text names withheld Ali phone',
    /Ali[\s\S]*Phone: NOT available/i.test(APPROVED_CONTACTS_PROMPT),
  );

  check(
    'prompt separates share vs capture',
    /Sharing contacts vs capturing a lead/i.test(APPROVED_CONTACTS_PROMPT),
  );

  const sessionEmail = 'mohammedammar7747@gmail.com';
  const confirmLead = validateContactReply(
    "Yes I'd like a follow-up",
    `I've got you as Mohammed Ammar at Catalent, reaching you at ${sessionEmail} — is that right? What would you like the team to know?`,
    { allowEmails: [sessionEmail] },
  );
  check(
    'session email confirmation passes with allowEmails',
    confirmLead.ok,
    reasons(confirmLead).join(', '),
  );

  const confirmLeadBlocked = validateContactReply(
    "Yes I'd like a follow-up",
    `I've got you at ${sessionEmail} — is that right?`,
  );
  check(
    'session email without allowlist is rejected',
    !confirmLeadBlocked.ok,
    reasons(confirmLeadBlocked).join(', '),
  );

  check(
    'lead intent: follow-up',
    isLeadCaptureIntent("yes I'd like a follow-up"),
  );
  check(
    'lead intent: email them that I want to contact them',
    isLeadCaptureIntent('email them that I want to contact them'),
  );
  check(
    'lead intent: have the team reach me',
    isLeadCaptureIntent('have the team reach me'),
  );
  check(
    'share ask is contact discussion',
    isContactDiscussion('How can I reach Ali?'),
  );
  check(
    'lead handoff is NOT contact-share discussion',
    !isContactDiscussion('email them that I want to contact them'),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
