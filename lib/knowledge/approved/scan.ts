/**
 * Ingest refuses a draft whose body names a confidential client or programme,
 * names a former employer outside founder context, or contains a contact
 * detail that is not an approved business contact. Pure.
 */
import { APPROVED_CONTACT_EMAILS, MARTY_PHONE_DIGITS } from '../../agent/contacts';
import { nameBodies } from './employers';
import type { KnowledgeDocInput } from './types';

export type ScanLists = {
  /** confidential-names.yaml plus every client_name in the manifest. */
  confidentialNames: string[];
  formerEmployers: string[];
};

export type ScanProblem = { kind: 'confidential-name' | 'former-employer' | 'personal-contact'; detail: string };

const NB = String.raw`(?<![\p{L}\p{N}])`;
const NA = String.raw`(?![\p{L}\p{N}])`;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

/** Employer names may appear only as founder career context. */
export function employersAllowed(doc: Pick<KnowledgeDocInput, 'type' | 'attribution'>): boolean {
  return doc.type === 'team' || doc.attribution === 'ali-prior-employment' || doc.attribution === 'ali-personal-contract';
}

function nameRe(bodies: string[]): RegExp {
  return new RegExp(`${NB}(?:${bodies.join('|')})${NA}`, 'iu');
}

export function scanDoc(doc: Pick<KnowledgeDocInput, 'id' | 'type' | 'attribution' | 'body' | 'title'>, lists: ScanLists): ScanProblem[] {
  const text = `${doc.title}\n${doc.body}`;
  const problems: ScanProblem[] = [];
  for (const name of lists.confidentialNames) {
    if (name.trim().length < 3) continue;
    if (nameRe(nameBodies(name)).test(text)) problems.push({ kind: 'confidential-name', detail: 'a confidential name' });
  }
  if (!employersAllowed(doc)) {
    for (const name of lists.formerEmployers) {
      if (nameRe(nameBodies(name)).test(text)) problems.push({ kind: 'former-employer', detail: name });
    }
  }
  for (const e of text.match(EMAIL_RE) ?? []) {
    if (!APPROVED_CONTACT_EMAILS.has(e.toLowerCase())) problems.push({ kind: 'personal-contact', detail: 'an email address' });
  }
  for (const p of text.match(PHONE_RE) ?? []) {
    if (!p.replace(/\D/g, '').endsWith(MARTY_PHONE_DIGITS)) problems.push({ kind: 'personal-contact', detail: 'a phone number' });
  }
  return problems;
}
