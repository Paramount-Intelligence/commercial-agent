/**
 * One safety filter for every piece of text a buyer can see: chat and voice
 * replies, case cards, search_cases summaries, one-pagers, transcript PDFs and
 * buyer emails. Pure: no database, no network.
 *
 * 1. Ali's former employers and contracting platforms are never presented as
 *    Paramount clients. Founder-background wording ("before Paramount, Ali
 *    worked at …") and denials ("… is not a client") stay. In case material
 *    (mode 'case') any mention is replaced, because case text is never
 *    founder background.
 * 2. Phone numbers and email addresses are removed unless they are an
 *    approved business contact (lib/agent/contacts.ts) or explicitly allowed
 *    (for example the buyer's own email in their own chat).
 * 3. A client's real name appears only when that case's name is approved.
 *    Callers pass the names they know (CaseStudy.clientName and the optional
 *    CONFIDENTIAL_NAMES env list, see clientNames.ts); nothing confidential is
 *    stored in this file.
 */
import { APPROVED_CONTACT_EMAILS, MARTY_PHONE_DIGITS } from '../agent/contacts';
import { nameBodies } from '../knowledge/approved/employers';

type NamePattern = { canonical: string; body: string; re: RegExp };

const SEP = String.raw`[\s\-_.]*`;
const word = (body: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${body})(?![\p{L}\p{N}])`, 'giu');
const pattern = (canonical: string, body: string): NamePattern => ({ canonical, body, re: word(body) });

/** Longest first, so "JazzCash" is handled before "Jazz". */
export const FORMER_EMPLOYERS: NamePattern[] = [
  pattern('JazzCash', `jazz${SEP}cash`),
  pattern('Bore and Bore', String.raw`bore\s*(?:and|&)\s*bore`),
  pattern('Jazz', 'jazz'),
  pattern('Mobilink', 'mobilink'),
  pattern('VEON', 'veon'),
  pattern('Bykea', 'b[iy]kea|baikeya|vaikea'),
  pattern('Daraz', String.raw`daraz(?:\.pk|\.com)?`),
  pattern('Alibaba', 'alibaba'),
  pattern('Toptal', String.raw`top${SEP}tal(?:\.com)?`),
  pattern('Gratia', 'gratia'),
  pattern('Catalant', 'catalant'),
];

const NB = String.raw`(?<![\p{L}\p{N}])`;
const NA = String.raw`(?![\p{L}\p{N}])`;

type EmployerSet = { patterns: NamePattern[]; clientBefore: RegExp; clientAfter: RegExp };

/**
 * Explicit client phrases, always filtered unless the sentence is a denial:
 * "our client X", "client X", "as a client, X" / "X, our client", "X was our client".
 */
function compileEmployers(patterns: NamePattern[]): EmployerSet {
  const any = patterns.map((p) => p.body).join('|');
  return {
    patterns,
    clientBefore: new RegExp(String.raw`${NB}(?:(?:our|the|a|your)\s+)?(?:clients?|customers?),?\s+(?:${any})${NA}`, 'giu'),
    clientAfter: new RegExp(
      String.raw`${NB}(?:${any})${NA},?\s+(?:(?:is|was|became|remains|as)\s+)?(?:our|a|the|one of our)\s+(?:clients?|customers?)${NA}`,
      'giu',
    ),
  };
}

/** Code list: used with KNOWLEDGE_SOURCE=legacy. */
const DEFAULT_EMPLOYERS = compileEmployers(FORMER_EMPLOYERS);
const compiledLists = new Map<string, EmployerSet>();

/** Employers named by the approved knowledge (founder-background docs), longest first. */
function employerSet(names: string[] | undefined): EmployerSet {
  if (!names?.length) return DEFAULT_EMPLOYERS;
  const key = names.join('\u0000');
  let set = compiledLists.get(key);
  if (!set) {
    const sorted = [...names].sort((a, b) => b.length - a.length);
    set = compileEmployers(sorted.map((n) => pattern(n, nameBodies(n).join('|'))));
    compiledLists.set(key, set);
  }
  return set;
}

/** A denial: a negation close before a client or Paramount word ("is not a Paramount client"). */
const DENIAL_RE =
  /\b(?:not|never|no|isn't|wasn't|aren't|weren't|don't|doesn't|didn't|cannot|can't|isn’t|wasn’t|aren’t|weren’t|don’t|doesn’t|didn’t|can’t)\b(?:\W+[\w’']+){0,5}?\W+(?:paramount|clients?|customers?|case|cases|engagements?|projects?|involved|relationship|work(?:ed)?\s+(?:for|with))\b/i;

/** Sentence opens with "Before (founding) Paramount" / "Prior to (founding) Paramount". */
const BEFORE_PARAMOUNT_RE = /^\W*(?:before|prior to)\s+(?:founding\s+|starting\s+|joining\s+)?paramount\b/i;

const FOUNDER = String.raw`(?:ali(?:\s+azzam)?|marty(?:\s+kaufman)?|our\s+(?:co-?)?founders?|(?:paramount(?:'s|’s)\s+)?(?:co-?)?founders?|he|she)`;
const EMPLOYMENT_VERB = String.raw`(?:worked|works|was|served|led|leads|built|spent|held|joined|started|managed|ran|headed|took|did|completed|consulted|contracted)`;

/** True when a founder is the subject of an employment phrase about this employer. */
function founderFramed(sentence: string, employerBody: string): boolean {
  if (BEFORE_PARAMOUNT_RE.test(sentence)) return true;
  const e = String.raw`(?:${employerBody})${NA}`;
  const subjectVerb = new RegExp(
    String.raw`${NB}${FOUNDER}${NA}(?:\s+(?:also|previously|earlier|once|then|first|later|had))*\s+${EMPLOYMENT_VERB}\b[^.!?]{0,80}?\b(?:at|for|with|through|via|on|in)\s+${e}`,
    'iu',
  );
  const possessive = new RegExp(
    String.raw`${NB}${FOUNDER}(?:'s|’s)\s+(?:(?:previous|former|earlier|time|years|role|roles|tenure|work|job|position|employment|career)\s+)+(?:at|with|on|through)\s+${e}`,
    'iu',
  );
  const onResume = new RegExp(
    String.raw`${NB}${e}[^.!?]{0,40}?\b(?:on|in|from)\s+${FOUNDER}(?:'s|’s)\s+(?:personal\s+|professional\s+)?(?:r[eé]sum[eé]|cv|employment history|work history|career history)`,
    'iu',
  );
  return subjectVerb.test(sentence) || possessive.test(sentence) || onResume.test(sentence);
}

const CLIENT_FRAMING_RE =
  /\b(clients?|customers?|engagements?|case stud(?:y|ies)|projects? for|built (?:it |this |a [\w\s-]{0,30})?for|delivered (?:it |this )?for|work(?:ed|ing)? (?:with|for)|on behalf of|partner(?:ed|ing)? with|helped|hired (?:us|paramount)|engaged (?:us|paramount)|chose (?:us|paramount)|for (?:a|an|the) )/i;

const PHONE_RES = [
  /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g,
  /(?<!\d)\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)/g,
];
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const TOKEN_RES = [/\[\[\s*(?:case|src)\s*:[^\]]*\]\]/gi, /\[\[?\s*(?:case|src)\s*:[^\]\s]*\]?\]?/gi];

export type ClientName = { name: string; replacement?: string };

export type BuyerTextContext = {
  /** 'reply' (default): judge each sentence. 'case': case material, always replace former employers. */
  mode?: 'reply' | 'case';
  /** Client names that are NOT approved for display. */
  clientNames?: ClientName[];
  /** Extra emails allowed in this text (for example the signed-in buyer's own). */
  allowedEmails?: string[];
  /** Former employers from the approved knowledge; omitted = the code list (legacy). */
  formerEmployers?: string[];
};

/** Split keeping separators, so the text can be rebuilt exactly. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])(\s+)|(\n+)/).filter((s) => s !== undefined && s !== '');
}

const mentions = (sentence: string, set: EmployerSet) =>
  set.patterns.filter((p) => ((p.re.lastIndex = 0), p.re.test(sentence)));

/**
 * Decide per sentence. Order matters:
 * 1. denial → keep ("Bykea is not a Paramount client");
 * 2. explicit client phrase → filter, whatever else the sentence says;
 * 3. founder employment framing for every employer named → keep;
 * 4. any client framing → filter; otherwise a neutral mention → keep.
 * Case material (mode 'case') is never founder background: always filter.
 */
export function formerEmployerVerdict(sentence: string, formerEmployers?: string[]): 'keep' | 'filter' | 'none' {
  const set = employerSet(formerEmployers);
  const named = mentions(sentence, set);
  if (named.length === 0) return 'none';
  if (DENIAL_RE.test(sentence)) return 'keep';
  set.clientBefore.lastIndex = 0;
  set.clientAfter.lastIndex = 0;
  if (set.clientBefore.test(sentence) || set.clientAfter.test(sentence)) return 'filter';
  if (named.every((p) => founderFramed(sentence, p.body))) return 'keep';
  return CLIENT_FRAMING_RE.test(sentence) ? 'filter' : 'keep';
}

function replaceFormerEmployers(sentence: string, mode: 'reply' | 'case', formerEmployers?: string[]): string {
  const set = employerSet(formerEmployers);
  const verdict =
    mode === 'case' ? (mentions(sentence, set).length ? 'filter' : 'none') : formerEmployerVerdict(sentence, formerEmployers);
  if (verdict !== 'filter') return sentence;
  let out = sentence.replace(set.clientBefore, 'a client').replace(set.clientAfter, 'a client');
  for (const p of set.patterns) out = out.replace(p.re, 'a client');
  return out;
}

function replaceClientNames(text: string, names: ClientName[]): string {
  let out = text;
  const sorted = [...names].filter((n) => n.name.trim().length >= 3).sort((a, b) => b.name.length - a.name.length);
  for (const n of sorted) {
    const body = n.name
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join(String.raw`[\s\-]*`);
    out = out.replace(word(body), n.replacement ?? 'a client');
  }
  return out;
}

function removeContacts(text: string, allowedEmails: string[]): string {
  const allowed = new Set([...APPROVED_CONTACT_EMAILS, ...allowedEmails.map((e) => e.toLowerCase())]);
  let out = text.replace(EMAIL_RE, (e) => (allowed.has(e.toLowerCase()) ? e : ''));
  for (const re of PHONE_RES) {
    out = out.replace(re, (p) => (p.replace(/\D/g, '').endsWith(MARTY_PHONE_DIGITS) ? p : ''));
  }
  return out;
}

function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(^|\n)a client/g, '$1A client')
    .replace(/([.!?]\s+)a client/g, '$1A client');
}

/** Filter text a buyer will read or hear. Keeps valid [[case:…]] tags (chat renders them as cards). */
export function filterBuyerText(text: string, ctx: BuyerTextContext = {}): string {
  if (!text) return text;
  const mode = ctx.mode ?? 'reply';
  let out = sentences(text)
    .map((s) => (/^\s+$/.test(s) ? s : replaceFormerEmployers(s, mode, ctx.formerEmployers)))
    .join('');
  out = replaceClientNames(out, ctx.clientNames ?? []);
  out = removeContacts(out, ctx.allowedEmails ?? []);
  return tidy(out);
}

/** For downloadable documents (PDFs, emails): also removes any citation token or fragment. */
export function filterBuyerDocumentText(text: string, ctx: BuyerTextContext = {}): string {
  let out = text;
  for (const re of TOKEN_RES) out = out.replace(re, '');
  return filterBuyerText(out, ctx).replace(/[ \t]{2,}/g, ' ');
}
