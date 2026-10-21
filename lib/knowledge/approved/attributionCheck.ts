/**
 * Deterministic attribution check (KNOWLEDGE_SOURCE=approved): a sentence that
 * cites founder-attributed work ([[case:ID]] with ali-prior-employment or
 * ali-personal-contract) must not frame it as Paramount's delivery or client.
 * Pure.
 */
import type { Attribution } from './types';

const CASE_TAG_RE = /\[\[case:([^\]]+)\]\]/gi;

/** "we built", "Paramount delivered", "our team developed", ... */
const FIRM_DELIVERY_RE =
  /\b(?:paramount|we|our\s+(?:team|firm|company|engineers))\b(?:['’]s)?[^.!?]{0,80}?\b(?:built|build|delivered|developed|designed|implemented|created|engineered|shipped|deployed)\b/i;
/** "Paramount has a case", "Paramount's case", "a Paramount case/engagement/project" */
const FIRM_CASE_RE =
  /\bparamount(?:['’]s)?\s+(?:(?:does\s+)?(?:has|have|had|did)\s+)?(?:an?\s+)?(?:[\w-]+\s+){0,3}?(?:case|engagement|project|client work)\b|\b(?:an?|our)\s+paramount\s+(?:case|engagement|project)\b/i;
const OUR_CLIENT_RE = /\b(?:our|paramount(?:['’]s)?)\s+(?:confidential\s+)?clients?\b/i;
const ANY_CLIENT_RE = /\b(?:for|with)\s+(?:an?|the|our|one)\s+(?:[\w-]+\s+){0,3}?clients?\b|\bclient\s+(?:engagement|work|project)\b/i;
/** A denial: "not a Paramount case", "wasn't a client engagement", "outside Paramount". */
const DENIAL_RE = /\b(?:not|never|isn['’]t|wasn['’]t|aren['’]t|weren['’]t|outside|rather than|instead of|no)\b[^.!?]{0,40}\b(?:paramount|clients?|engagements?|cases?)\b/i;

const BEFORE_PARAMOUNT_RE = /\b(?:before|prior to)\s+(?:founding|starting|joining|co-founding)?\s*paramount(?:\s+intelligence)?\b/gi;

export type AttributionRule = 'firm-delivery' | 'firm-case' | 'our-client' | 'prior-employment-client';

export type AttributionCheck = { ok: true } | { ok: false; ids: string[]; sentence: string; rule: AttributionRule };

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
}

export function checkCaseAttribution(reply: string, attributionOf: ReadonlyMap<string, Attribution>): AttributionCheck {
  for (const sentence of sentences(reply)) {
    const ids = [...sentence.matchAll(CASE_TAG_RE)].map((m) => m[1].trim());
    const founder = ids.filter((id) => {
      const a = attributionOf.get(id);
      return a === 'ali-prior-employment' || a === 'ali-personal-contract';
    });
    if (founder.length === 0) continue;
    // "Before founding Paramount, Ali built ..." is the required wording, not firm framing.
    const text = sentence.replace(CASE_TAG_RE, ' ').replace(BEFORE_PARAMOUNT_RE, ' ');
    if (DENIAL_RE.test(text)) continue;
    const prior = founder.some((id) => attributionOf.get(id) === 'ali-prior-employment');
    const rule: AttributionRule | null = FIRM_DELIVERY_RE.test(text)
      ? 'firm-delivery'
      : FIRM_CASE_RE.test(text)
        ? 'firm-case'
        : OUR_CLIENT_RE.test(text)
          ? 'our-client'
          : prior && ANY_CLIENT_RE.test(text)
            ? 'prior-employment-client'
            : null;
    if (rule) return { ok: false, ids: founder, sentence: sentence.slice(0, 220), rule };
  }
  return { ok: true };
}

export function buildAttributionFeedback(failure: Extract<AttributionCheck, { ok: false }>, attributionOf: ReadonlyMap<string, Attribution>): string {
  const lines = failure.ids.map((id) =>
    attributionOf.get(id) === 'ali-prior-employment'
      ? `[[case:${id}]] is founder background: Ali's own work as an employee before founding Paramount. Describe it only as "before founding Paramount, Ali worked at ..." — never as a Paramount case, engagement or client, and it has no client.`
      : `[[case:${id}]] is founder-led work: Ali's own contract work, not a Paramount engagement. Say "our founder led ..." — never "we built" and never "Paramount's client".`,
  );
  return `ATTRIBUTION FIX REQUIRED. This sentence misattributes founder work: "${failure.sentence}". ${lines.join(' ')} Rewrite the reply with the correct wording.`;
}

/**
 * Staging diagnostics: the rejected sentence and the rule, so false positives
 * can be reviewed. Only on builds of develop (commercial-agent-staging), never
 * on production builds of main. Contact details and the buyer's own name and
 * company are removed first.
 */
export function attributionDebugEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_GIT_COMMIT_REF?.trim() === 'develop';
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

export function redactForLog(sentence: string, personal: Array<string | null | undefined> = []): string {
  let out = sentence.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
  for (const p of personal) {
    for (const word of (p ?? '').split(/\s+/).filter((w) => w.length >= 3)) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, 'giu'), '[buyer]');
    }
  }
  return out;
}
