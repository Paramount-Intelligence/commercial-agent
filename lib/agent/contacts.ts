/**
 * Ali/Marty-approved contact reference — source of truth.
 *
 * Share ONLY what appears here. Ali's phone is intentionally withheld
 * (anti-fabrication: never invent a number). Mirror of pricing.ts pattern.
 *
 * Approved: Ali & Marty, 2026-07-22.
 */
export const APPROVED_CONTACTS = {
  approval: {
    approvedBy: 'Ali and Marty',
    approvedOn: '2026-07-22',
    aliPhoneMayBeShared: false,
  },
  website: 'https://paramountintelligence.co',
  ali: {
    name: 'Ali Azzam',
    fullName: 'Syed Ali Azzam',
    title: 'CEO & Founding Partner',
    email: 'ali@paramountintelligence.co',
    phone: null as string | null, // WITHHELD — never share, never invent
    locationNote: 'Based outside the United States',
  },
  marty: {
    name: 'Marty Kaufman',
    title: 'Co-founder & Chief Commercial Officer',
    email: 'marty@paramountintelligence.co',
    phone: '443.494.9144',
    locationNote: 'Washington DC–Baltimore area; US citizen',
  },
} as const;

/** Digits-only form of Marty's approved phone for validation. */
export const MARTY_PHONE_DIGITS = '4434949144';

export const APPROVED_CONTACT_EMAILS = new Set([
  APPROVED_CONTACTS.ali.email.toLowerCase(),
  APPROVED_CONTACTS.marty.email.toLowerCase(),
]);

export const APPROVED_CONTACTS_PROMPT = `
## Approved contact reference — source of truth

Share ONLY the details below. Never invent emails, phone numbers, or addresses.

- **Ali Azzam** — CEO & Founding Partner. Email: ali@paramountintelligence.co. Based outside the US.
  Phone: NOT available for sharing. If asked for Ali's phone, decline that item and offer his email instead. Never invent a phone number for Ali.
- **Marty Kaufman** — Co-founder & Chief Commercial Officer. Email: marty@paramountintelligence.co. Phone: 443.494.9144. Based in the Washington DC–Baltimore area; US citizen.
- **Company website:** https://paramountintelligence.co

### Sharing contacts vs capturing a lead (do not mix)

These are TWO different flows:

1. **SHARING contacts** — User asks how to reach Ali/Marty/the team (emails, Marty's phone, website). Give the approved details above. Do **not** call \`capture_lead\` just because you shared contacts. Optionally offer a follow-up once.

2. **CAPTURING a lead** — User wants the **team to contact THEM** / follow up / "email them that I want to be contacted" / "have them reach me" / "I'd like a follow-up". Do **NOT** re-list Ali/Marty emails. Confirm the user's **SESSION USER** name/email/company (never re-ask those when on file), ask ONLY the topic, then call \`capture_lead\`.

When a user asks how to reach Ali, Marty, or the team: share the approved emails freely; share Marty's phone when they ask for a phone / Marty's number. Stay warm and helpful.
`.trim();

/** User wants the Paramount team to reach *them* (lead handoff), not contact details. */
export const LEAD_CAPTURE_INTENT_RE =
  /\b(?:follow[\s-]?up|have (?:them|the team|ali|marty|someone) (?:contact|reach|call|email|get (?:back|in touch))|(?:contact|reach|email|call) me(?:\b| back)|(?:want|like|need)(?:s)? (?:a |the )?(?:team )?follow[\s-]?up|(?:want|like)(?:s)? (?:them|the team) to (?:contact|reach|follow|email|call)|(?:team|ali|marty) (?:to )?(?:follow up|reach out|get (?:back|in touch))|(?:email|tell|message|notify|let) them\b[\s\S]{0,80}\b(?:contact|reach|follow)|connect me with (?:the )?team|hand ?off|leave my (?:details|info)|have (?:the )?team (?:reach|contact|email|call) me)\b/i;

/** User is asking for Ali/Marty/team contact details to use themselves. */
const CONTACT_SHARE_ASK_RE =
  /\b(?:how (?:do|can) i (?:reach|contact|get hold|email|call)|(?:what(?:'s| is)|give me|share|send me) (?:ali|marty|(?:the )?team)?[\s\S]{0,40}\b(?:email|phone|number|contact)|(?:ali|marty)\b[\s\S]{0,40}\b(?:email|phone|number|contact)\b|\b(?:email|phone|number|contact)\b[\s\S]{0,40}\b(?:ali|marty)\b|\blinkedin\b|\bget in touch with (?:ali|marty|paramount)\b)/i;

const ALI_PHONE_ASK_RE =
  /\bali(?:'s|s)?\b[\s\S]{0,40}\b(?:phone|number|mobile|cell|call)\b|\b(?:phone|number|mobile|cell)\b[\s\S]{0,40}\bali\b/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_CANDIDATE_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;

export function isLeadCaptureIntent(userText: string): boolean {
  return LEAD_CAPTURE_INTENT_RE.test(userText);
}

/**
 * True when the turn is about sharing Paramount contact details.
 * Lead-capture intents ("have them contact me") are NOT contact-share,
 * unless the user also explicitly asks for Ali/Marty emails/phones.
 */
export function isContactDiscussion(userText: string, replyText = ''): boolean {
  if (ALI_PHONE_ASK_RE.test(userText)) return true;
  if (isLeadCaptureIntent(userText) && !CONTACT_SHARE_ASK_RE.test(userText)) {
    return CONTACT_SHARE_ASK_RE.test(replyText);
  }
  return (
    CONTACT_SHARE_ASK_RE.test(userText) ||
    CONTACT_SHARE_ASK_RE.test(replyText) ||
    // Legacy broad match for replies that still discuss reaching the team
    /\b(?:reach|contact|email|phone)\b[\s\S]{0,40}\b(?:ali|marty|team)\b/i.test(
      replyText,
    )
  );
}

export function normalizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export type ContactValidationResult =
  | { ok: true; discussed: boolean }
  | { ok: false; discussed: true; reasons: string[] };

export type ContactValidationOptions = {
  /**
   * Session / prospect emails that Jackie may repeat when confirming a lead.
   * These are NOT Paramount contacts — they must not fail the gate.
   */
  allowEmails?: string[];
};

/**
 * Deterministic post-generation contact gate. Blocks fabricated emails/phones
 * and any attempt to invent Ali's withheld number.
 * Session prospect emails (lead confirmation) are allowlisted via options.
 */
export function validateContactReply(
  userText: string,
  replyText: string,
  options?: ContactValidationOptions,
): ContactValidationResult {
  const emailsInReply = [...replyText.matchAll(EMAIL_RE)].map((m) => m[0]);
  const phones = [...replyText.matchAll(PHONE_CANDIDATE_RE)].map((m) => m[0]);
  const discussed =
    isContactDiscussion(userText, replyText) ||
    isLeadCaptureIntent(userText) ||
    emailsInReply.length > 0 ||
    phones.length > 0;
  if (!discussed) return { ok: true, discussed: false };

  const allowedEmails = new Set<string>([
    ...APPROVED_CONTACT_EMAILS,
    ...(options?.allowEmails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ]);

  const reasons: string[] = [];

  for (const raw of emailsInReply) {
    const email = raw.toLowerCase();
    if (!allowedEmails.has(email)) {
      reasons.push(`unapproved email ${raw}`);
    }
  }

  for (const phone of phones) {
    const digits = normalizePhoneDigits(phone);
    // Allow US country code prefix on Marty's number
    const ok =
      digits === MARTY_PHONE_DIGITS || digits === `1${MARTY_PHONE_DIGITS}`;
    if (!ok) {
      reasons.push(`unapproved phone number ${phone}`);
    }
  }

  if (ALI_PHONE_ASK_RE.test(userText) && phones.length > 0) {
    reasons.push("Ali's phone was requested but a phone number was disclosed");
  }

  return reasons.length
    ? { ok: false, discussed: true, reasons: [...new Set(reasons)] }
    : { ok: true, discussed: true };
}

export function buildContactRegenerateFeedback(reasons: string[]): string {
  return (
    'Your proposed contact reply failed the approved-contact gate: ' +
    `${reasons.join('; ')}. Use ONLY the approved contact reference for Paramount contacts. ` +
    'Share ali@paramountintelligence.co and/or marty@paramountintelligence.co as appropriate. ' +
    "Marty's phone 443.494.9144 may be shared when asked. " +
    "Never invent or share a phone number for Ali — decline and offer his email instead. " +
    'When confirming a lead follow-up, repeating the SESSION USER email/name/company is allowed and required — do not treat the prospect\'s email as a Paramount contact. ' +
    'If the user wants the team to contact THEM, do NOT re-list Ali/Marty details — confirm session profile + ask topic, then capture_lead.'
  );
}

export const APPROVED_CONTACTS_FALLBACK_ALI_PHONE =
  "I don't share Ali's direct number, but you can reach him at ali@paramountintelligence.co. I can also have the team follow up with you if you'd like.";

export const APPROVED_CONTACTS_FALLBACK_SHARE =
  "You can reach Ali Azzam at ali@paramountintelligence.co and Marty Kaufman at marty@paramountintelligence.co. Marty's phone is 443.494.9144. Our website is https://paramountintelligence.co. I don't share Ali's direct number. I can also have the team follow up with you if you'd like.";