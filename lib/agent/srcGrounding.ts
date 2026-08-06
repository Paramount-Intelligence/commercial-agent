/**
 * Company/founder grounding gate (src namespace).
 *
 * CODE FLOOR: deterministic. [[src:CHUNK_ID]] validates ONLY against this
 * turn's search_company_info hits above the relevance floor. Never crosses
 * into the [[case:ID]] allowlist.
 */
import { APPROVED_CONTACTS } from './contacts';

export const SRC_TAG_RE = /\[\[src:([^\]]+)\]\]/gi;
export const CASE_TAG_RE = /\[\[case:([^\]]+)\]\]/gi;

export const COMPANY_SRC_SAFE_FALLBACK =
  `I don't have that detail on file — Ali can give you the full picture: ${APPROVED_CONTACTS.ali.email}.`;

/** Cosine similarity floor for licensing a ContentChunk as [[src]] evidence. */
export function companyInfoSimilarityFloor(): number {
  const raw = process.env.COMPANY_INFO_SIMILARITY_FLOOR?.trim();
  if (!raw) return 0.45;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.45;
}

export type AttributionClass =
  | 'paramount-positioning'
  | 'paramount-delivery-outcome'
  | 'ali-personal-contract'
  | 'ali-prior-employment';

export type RetrievedSrcChunk = {
  id: string;
  sim: number;
  attributionClass: AttributionClass | null;
  employer: string | null;
  startDate: string | null;
  endDate: string | null;
  sourceType: string;
  heading: string;
  content: string;
};

export type SrcGroundingTelemetry = {
  query: string | null;
  hitCount: number;
  topRelevanceScore: number | null;
};

export type SrcValidationFailureRule =
  | 'missing_src_token'
  | 'unknown_src_id'
  | 'cross_namespace_src'
  | 'stale_or_below_floor_src'
  | 'non_assertable_src'
  | 'ali_misattributed_as_firm'
  | 'delivery_outcome_without_case'
  | 'ali_metric_without_case'
  | 'unsourced_delivery_outcome'
  | 'deanon_employer_case_bridge'
  | 'suppressed_uncleared_client_metric';

export type SrcValidationResult =
  | { ok: true; strippedText: string }
  | {
      ok: false;
      rule: SrcValidationFailureRule;
      offendingAssertion: string;
      invalidSrcIds: string[];
      validSrcIds: string[];
    };

/** Employers that can fingerprint confidential cases. */
export const RESTRICTED_EMPLOYERS = [
  'Bykea',
  'Jazz',
  'JazzCash',
  'Daraz',
  'Toptal',
] as const;

const PROTECTED_ENTITY_ALIASES: Array<{ canonical: string; aliases: RegExp }> = [
  {
    canonical: 'paramount',
    aliases: /\bparamount(?:\s+intelligence)?\b/i,
  },
  {
    canonical: 'ali',
    aliases: /\bali(?:\s+azzam)?\b|\bsyed\s+ali\s+azzam\b/i,
  },
  {
    canonical: 'marty',
    aliases: /\bmarty(?:\s+kaufman)?\b/i,
  },
  {
    canonical: 'bykea',
    // Include common misspelling from the observed failure.
    aliases: /\bbykea\b|\bbaikeya\b|\bbyke+ya\b/i,
  },
  {
    canonical: 'jazz',
    aliases: /\bjazz(?:cash)?\b|\bveon\b/i,
  },
  {
    canonical: 'daraz',
    aliases: /\bdaraz\b|\balibaba[- ]backed\b/i,
  },
  {
    canonical: 'toptal',
    aliases: /\btoptal\b/i,
  },
  {
    canonical: 'catalant',
    aliases: /\bcatalant\b/i,
  },
  {
    canonical: 'schneider',
    aliases: /\bschneider(?:\s+electric)?\b/i,
  },
  {
    canonical: 'syngenta',
    aliases: /\bsyngenta\b/i,
  },
  {
    canonical: 'donaldson',
    aliases: /\bdonaldson\b/i,
  },
  {
    canonical: 'gratia',
    aliases: /\bgratia\b/i,
  },
  {
    canonical: 'bore',
    aliases: /\bbore\s+and\s+bore\b/i,
  },
];

/**
 * Founder/company facts that are specific on their own: founding status, a named
 * role/title, an employment phrase, or a month-year / year-range tenure marker.
 * General soft characterizations ("Paramount helps complex orgs…") do not match.
 */
const SELF_SUFFICIENT_CLAIM_RE =
  /\b(?:co[- ]?founded|co[- ]?founder|founded|founding\s+status|founder\s+of)\b|\b(?:data\s+scientist(?:\s+i{1,3})?|senior\s+ai\s+engineer|ai\s+engineer|business\s+analyst|forward[- ]deployed\s+engineer|independent\s+consultant|ceo|cco|founding\s+partner)\b|\b(?:worked\s+(?:at|for|as)|role\s+at|title\s+(?:was|is|at)|employed\s+(?:at|by)|tenure\s+at|experience\s+(?:at|in|with))\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b|\b\d{4}\s*[-–—]\s*(?:\d{4}|present)\b/i;

/**
 * Quantities that only assert something about a founder/company when the same
 * sentence names one. Every alternative requires a real digit — a bare comma or
 * sentence-final period must never register as a metric, or the gate rejects
 * ordinary prose ("…to the team, but…") and ships SAFE_FALLBACK instead.
 */
const ENTITY_SCOPED_METRIC_RE =
  /\$\s*\d[\d,]*(?:\.\d+)?\s*[KMB]?\b|\b\d[\d,]*(?:\.\d+)?\s*%|\b\d[\d,]*(?:\.\d+)?\s*percent\b|\bfortune\s*(?:500|1000)\b|\b\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|million|billion|thousand)\+?\b|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s*(?:years?|months?)\b/i;

/** A bare year is a tenure/date claim only alongside a *named* entity. */
const BARE_YEAR_RE = /\b(?:19|20)\d{2}\b/;

/** First-person firm voice ("we delivered…") stands in for a named entity. */
const FIRM_SELF_REFERENCE_RE =
  /\b(?:we|we'(?:re|ve|ll)|our|ours|the\s+firm|this\s+firm)\b/i;

/** Quantified delivered-outcome signal (Part 2). Never sole rejection basis. */
export const QUANTIFIED_DELIVERED_OUTCOME_RE =
  /\b(?:approximately|about|around|roughly|nearly|over|up\s+to)?\s*\$\s*[\d,]+(?:\.\d+)?\s*[KMB]?\b|\b\d+(?:\.\d+)?\s*%\b|\b(?:reduc(?:ed|ing|tion)|improv(?:ed|ing|ement)|increas(?:ed|ing|e)|deflect(?:ed|ion)|sav(?:ed|ings)|contribut(?:ed|ing)|generat(?:ed|ing)|unlock(?:ed|ing))\b[\s\S]{0,48}\b(?:\$\s*[\d,]+|\d+(?:\.\d+)?\s*%|\d+\s*[KMB]\b)/i;

/**
 * A CLAIMED delivered outcome: an outcome verb bound to a metric.
 *
 * Deliberately narrower than QUANTIFIED_DELIVERED_OUTCOME_RE, which also matches a
 * bare "$90" or "10-30%" and therefore fires on rate-card prose. Verbs like
 * build/built/cut are excluded for the same reason ("Build work: $90-$200 per hour").
 * This is the only signal allowed to reject on its own when no source class
 * licenses the sentence.
 */
const OUTCOME_VERB =
  'reduc(?:ed|ing|tion|es)|improv(?:ed|ing|ement|es)|increas(?:ed|ing|es|e)|deflect(?:ed|ing|ion|s)|sav(?:ed|ing|ings|es)|generat(?:ed|ing|es)|unlock(?:ed|ing|s)|accelerat(?:ed|ing|es)|eliminat(?:ed|ing|es)|achiev(?:ed|ing|es)|shorten(?:ed|ing|s)|automat(?:ed|ing|es)|deliver(?:ed|ing|s)|deploy(?:ed|ing|s)';
const OUTCOME_METRIC =
  '\\$\\s*[\\d,]+(?:\\.\\d+)?\\s*[KMB]?|\\d+(?:\\.\\d+)?\\s*%|\\d+\\s*[KMB]\\b';
export const DELIVERED_OUTCOME_CLAIM_RE = new RegExp(
  `\\b(?:${OUTCOME_VERB})\\b[\\s\\S]{0,60}?(?:${OUTCOME_METRIC})|(?:${OUTCOME_METRIC})[\\s\\S]{0,60}?\\b(?:${OUTCOME_VERB})\\b`,
  'i',
);

const PARAMOUNT_FIRM_FRAMING_RE =
  /\b(?:paramount(?:\s+intelligence)?(?:'s)?)\s+(?:has|have|delivered|built|deployed|achieved|worked\s+with|experience|track\s+record|clients?|engagements?)\b|\b(?:we|our\s+firm|the\s+firm)\s+(?:delivered|built|deployed|achieved|worked\s+with)\b|\bparamount(?:\s+intelligence)?\s+(?:has|have)\s+(?:fortune\s*500|fortune\s*1000)\b/i;

const ALI_PERSONAL_ATTRIBUTION_RE =
  /\b(?:ali(?:\s+azzam)?(?:'s)?|he|his)\b[\s\S]{0,40}\b(?:worked|was|served|joined|role|title|at|for|as|background|experience)\b|\bat\s+[A-Z][\w&]*(?:\s+[A-Z][\w&]*)*\b[\s\S]{0,40}\bali\b/i;

const DEANON_BRIDGE_RE =
  /\b(?:same\s+(?:client|company|employer)|that\s+(?:client|company)|this\s+(?:case|client)|identified\s+as|de[- ]?anonym|actually\s+(?:bykea|jazz|daraz|toptal)|client\s+(?:was|is)\s+(?:bykea|jazz|daraz|toptal))\b/i;

const JAZZ_BYKEA_METRIC_RE =
  /(?:\$\s*[\d,.]+\s*[KMB]\b|\b\d+(?:\.\d+)?\s*%\b|\b70\s*m(?:illion)?\+?\b|\bdynamic\s+pricing\b)/i;

export function suppressUnclearedClientMetrics(): boolean {
  const raw = process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') {
    return false;
  }
  return true; // conservative default
}

export function extractSrcIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(SRC_TAG_RE)) {
    const id = (m[1] ?? '').trim();
    if (id) ids.push(id);
  }
  return ids;
}

export function stripSrcTokens(text: string): string {
  return text
    .replace(SRC_TAG_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ?\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textMentionsProtectedEntity(text: string): boolean {
  return PROTECTED_ENTITY_ALIASES.some((e) => e.aliases.test(text));
}

export function shouldActivateSrcGate(opts: {
  userMessage: string;
  replyText: string;
  usedSearchCompanyInfo: boolean;
}): boolean {
  if (opts.usedSearchCompanyInfo) return true;
  if (textMentionsProtectedEntity(opts.userMessage)) return true;
  if (textMentionsProtectedEntity(opts.replyText)) return true;
  return false;
}

export function sentenceHasSpecificFounderCompanyClaim(sentence: string): boolean {
  if (SELF_SUFFICIENT_CLAIM_RE.test(sentence)) return true;
  // The one permitted prose signal: an outcome verb bound to a metric.
  if (DELIVERED_OUTCOME_CLAIM_RE.test(sentence)) return true;

  const namesEntity = textMentionsProtectedEntity(sentence);
  if (namesEntity && BARE_YEAR_RE.test(sentence)) return true;
  if (!namesEntity && !FIRM_SELF_REFERENCE_RE.test(sentence)) return false;
  return ENTITY_SCOPED_METRIC_RE.test(sentence);
}

/** Split into rough declarative sentences; keep short. */
export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isNonAssertiveConnective(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return true;
  if (/^(?:sure|happy to|of course|thanks|thank you|got it|okay|ok|great|understood)\b/i.test(s)) {
    return true;
  }
  if (
    /i don'?t have that detail on file/i.test(s) ||
    /ali can give you the full picture/i.test(s)
  ) {
    return true;
  }
  // Soft offers / questions
  if (/\?\s*$/.test(s)) return true;
  if (
    /^(?:i can|would you like|let me know|feel free|if you(?:'d| would) like)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  return false;
}

function employerMentioned(text: string, employer: string | null): boolean {
  if (!employer) return false;
  const base = employer
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return false;
  const primary = base.split(/[/,]/)[0]?.trim() ?? base;
  const core = primary
    .replace(/\b(?:part of|an?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join('\\s+');
  if (!core) return false;
  try {
    return new RegExp(`\\b${core}\\b`, 'i').test(text);
  } catch {
    return text.toLowerCase().includes(primary.toLowerCase());
  }
}

function restrictedEmployerInText(text: string): string | null {
  for (const name of RESTRICTED_EMPLOYERS) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) return name;
  }
  if (/\bbaikeya\b/i.test(text)) return 'Bykea';
  return null;
}

/**
 * Pick a retrieved chunk that can license a sentence missing [[src]].
 * Conservative: require an employer (or protected-entity) match in the sentence.
 * Never invents a chunk — empty / unmatched retrieval still fails closed.
 */
function pickLicensingChunk(
  sentence: string,
  retrievedSrc: ReadonlyMap<string, RetrievedSrcChunk>,
): RetrievedSrcChunk | null {
  if (retrievedSrc.size === 0) return null;

  const candidates = [...retrievedSrc.values()].filter((c) => {
    // Don't auto-license delivery-outcome chunks onto metric sentences —
    // those still need [[case:ID]].
    if (
      c.attributionClass === 'paramount-delivery-outcome' &&
      (QUANTIFIED_DELIVERED_OUTCOME_RE.test(sentence) ||
        DELIVERED_OUTCOME_CLAIM_RE.test(sentence))
    ) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;

  const byEmployer = candidates.filter((c) =>
    employerMentioned(sentence, c.employer),
  );
  const pool = byEmployer.length > 0 ? byEmployer : [];

  // Fallback: chunk content/heading names a protected entity that the sentence also names.
  if (pool.length === 0) {
    for (const c of candidates) {
      const blob = `${c.employer ?? ''} ${c.heading} ${c.content.slice(0, 400)}`;
      const shared = PROTECTED_ENTITY_ALIASES.some(
        (e) => e.aliases.test(sentence) && e.aliases.test(blob),
      );
      if (shared) pool.push(c);
    }
  }
  if (pool.length === 0) return null;

  // Prefer content that mentions a role/title cue from the sentence.
  const roleCue =
    sentence.match(
      /\b(?:data\s+scientist(?:\s+i{1,3})?|senior\s+ai\s+engineer|ai\s+engineer|business\s+analyst|forward[- ]deployed\s+engineer|independent\s+consultant|ceo|cco|founding\s+partner)\b/i,
    )?.[0] ?? null;

  if (roleCue) {
    const roleHits = pool.filter((c) =>
      new RegExp(roleCue.replace(/\s+/g, '\\s+'), 'i').test(
        `${c.heading} ${c.content}`,
      ),
    );
    if (roleHits.length > 0) {
      return roleHits.sort((a, b) => b.sim - a.sim)[0] ?? null;
    }
  }

  return pool.sort((a, b) => b.sim - a.sim)[0] ?? null;
}

/**
 * CODE-FLOOR repair: when the model states a specific founder/company fact
 * grounded in this turn's retrieval but forgot [[src:ID]], attach the matching
 * citation. Returns null when any claim cannot be licensed (fail closed).
 * Tokens are still stripped before ship.
 */
export function repairMissingSrcCitations(
  replyText: string,
  retrievedSrc: ReadonlyMap<string, RetrievedSrcChunk>,
): string | null {
  if (!replyText.trim() || retrievedSrc.size === 0) return null;

  const sentences = splitSentences(replyText);
  let changed = false;
  const out: string[] = [];

  for (const sentence of sentences) {
    if (
      isNonAssertiveConnective(sentence) ||
      !sentenceHasSpecificFounderCompanyClaim(sentence) ||
      extractSrcIds(sentence).length > 0
    ) {
      out.push(sentence);
      continue;
    }

    // Case-cited metrics don't need src.
    const caseInSentence = [...sentence.matchAll(CASE_TAG_RE)]
      .map((m) => (m[1] ?? '').trim())
      .filter(Boolean);
    if (
      caseInSentence.length > 0 &&
      QUANTIFIED_DELIVERED_OUTCOME_RE.test(sentence)
    ) {
      out.push(sentence);
      continue;
    }

    const chunk = pickLicensingChunk(sentence, retrievedSrc);
    if (!chunk) return null;

    const token = `[[src:${chunk.id}]]`;
    const repaired = /[.!?]"?$/.test(sentence.trim())
      ? sentence.replace(/([.!?]"?)\s*$/, ` ${token}$1`)
      : `${sentence.trim()} ${token}`;
    out.push(repaired);
    changed = true;
  }

  return changed ? out.join(' ') : null;
}

export type ValidateSrcGroundingInput = {
  replyText: string;
  retrievedSrc: ReadonlyMap<string, RetrievedSrcChunk>;
  /** Case IDs valid this conversation — used only to reject cross-namespace src. */
  caseRetrievedIds: ReadonlySet<string>;
  /** Whether any [[case:ID]] in the sentence is valid (pass-through for metrics). */
  validCaseIdsInReply: ReadonlySet<string>;
  retrievedCaseTitles?: ReadonlyMap<string, string>;
  gateActive: boolean;
};

/**
 * Validate src grounding for founder/company assertions.
 * When the gate is inactive, only malformed/cross-namespace [[src]] tags fail.
 */
export function validateSrcGrounding(
  input: ValidateSrcGroundingInput,
): SrcValidationResult {
  const {
    replyText,
    retrievedSrc,
    caseRetrievedIds,
    validCaseIdsInReply,
    retrievedCaseTitles = new Map(),
    gateActive,
  } = input;

  const citedSrc = extractSrcIds(replyText);
  const validSrcIds = [...retrievedSrc.keys()];
  const invalidSrcIds: string[] = [];

  for (const id of citedSrc) {
    if (caseRetrievedIds.has(id) && !retrievedSrc.has(id)) {
      return {
        ok: false,
        rule: 'cross_namespace_src',
        offendingAssertion: `[[src:${id}]]`,
        invalidSrcIds: [id],
        validSrcIds,
      };
    }
    if (!retrievedSrc.has(id)) {
      invalidSrcIds.push(id);
    }
  }
  if (invalidSrcIds.length > 0) {
    return {
      ok: false,
      rule: 'unknown_src_id',
      offendingAssertion: `[[src:${invalidSrcIds[0]}]]`,
      invalidSrcIds: [...new Set(invalidSrcIds)],
      validSrcIds,
    };
  }

  // Part 3 de-anon: employer name + case title/citation bridge in same window.
  if (gateActive || citedSrc.length > 0 || validCaseIdsInReply.size > 0) {
    const restricted = restrictedEmployerInText(replyText);
    if (restricted) {
      const lower = replyText.toLowerCase();
      let bridgesCase = DEANON_BRIDGE_RE.test(replyText);
      if (!bridgesCase) {
        for (const [, title] of retrievedCaseTitles) {
          if (
            title.length >= 4 &&
            lower.includes(title.toLowerCase()) &&
            lower.includes(restricted.toLowerCase())
          ) {
            bridgesCase = true;
            break;
          }
        }
      }
      if (!bridgesCase && validCaseIdsInReply.size > 0) {
        // Same reply cites a case AND names a restricted employer as confirmation.
        if (
          /\b(?:client|case|engagement|project)\b/i.test(replyText) &&
          (/\b(?:was|is|namely|i\.e\.|ie|aka|actually)\b/i.test(replyText) ||
            DEANON_BRIDGE_RE.test(replyText))
        ) {
          bridgesCase = true;
        }
      }
      if (bridgesCase) {
        return {
          ok: false,
          rule: 'deanon_employer_case_bridge',
          offendingAssertion: replyText.slice(0, 220),
          invalidSrcIds: [],
          validSrcIds,
        };
      }
    }
  }

  if (!gateActive) {
    return { ok: true, strippedText: stripSrcTokens(replyText) };
  }

  const sentences = splitSentences(replyText);
  for (const sentence of sentences) {
    if (isNonAssertiveConnective(sentence)) continue;
    if (!sentenceHasSpecificFounderCompanyClaim(sentence)) continue;

    const srcInSentence = extractSrcIds(sentence);
    const caseInSentence = [
      ...sentence.matchAll(CASE_TAG_RE),
    ].map((m) => (m[1] ?? '').trim()).filter(Boolean);
    const hasValidCase = caseInSentence.some((id) => validCaseIdsInReply.has(id));

    if (srcInSentence.length === 0) {
      // Quantified outcome with a valid case citation is allowed (pricing/case non-regression).
      if (hasValidCase && QUANTIFIED_DELIVERED_OUTCOME_RE.test(sentence)) {
        continue;
      }
      return {
        ok: false,
        rule: 'missing_src_token',
        offendingAssertion: sentence.slice(0, 220),
        invalidSrcIds: [],
        validSrcIds,
      };
    }

    const chunks = srcInSentence
      .map((id) => retrievedSrc.get(id))
      .filter((c): c is RetrievedSrcChunk => Boolean(c));

    for (const chunk of chunks) {
      if (chunk.attributionClass === 'paramount-delivery-outcome') {
        // Non-assertable for shipped claims — even with [[src]].
        if (
          QUANTIFIED_DELIVERED_OUTCOME_RE.test(sentence) ||
          sentenceHasSpecificFounderCompanyClaim(sentence)
        ) {
          if (!hasValidCase) {
            return {
              ok: false,
              rule: 'non_assertable_src',
              offendingAssertion: sentence.slice(0, 220),
              invalidSrcIds: [chunk.id],
              validSrcIds,
            };
          }
        }
      }
    }

    if (QUANTIFIED_DELIVERED_OUTCOME_RE.test(sentence) && !hasValidCase) {
      const aliBacked = chunks.some(
        (c) =>
          c.attributionClass === 'ali-personal-contract' ||
          c.attributionClass === 'ali-prior-employment',
      );
      const deliveryBacked = chunks.some(
        (c) => c.attributionClass === 'paramount-delivery-outcome',
      );
      if (deliveryBacked) {
        return {
          ok: false,
          rule: 'delivery_outcome_without_case',
          offendingAssertion: sentence.slice(0, 220),
          invalidSrcIds: chunks.map((c) => c.id),
          validSrcIds,
        };
      }
      if (aliBacked) {
        // Suppress public Jazz/Bykea metrics when flag is on.
        const employerHit = chunks.some(
          (c) =>
            c.employer &&
            RESTRICTED_EMPLOYERS.some((e) =>
              employerMentioned(c.employer ?? '', e),
            ),
        );
        const jazzBykeaMetric =
          employerHit &&
          (/\b(?:bykea|baikeya|jazz)\b/i.test(sentence) ||
            chunks.some((c) =>
              /bykea|jazz/i.test(c.employer ?? ''),
            )) &&
          JAZZ_BYKEA_METRIC_RE.test(sentence);

        if (suppressUnclearedClientMetrics() && jazzBykeaMetric) {
          return {
            ok: false,
            rule: 'suppressed_uncleared_client_metric',
            offendingAssertion: sentence.slice(0, 220),
            invalidSrcIds: chunks.map((c) => c.id),
            validSrcIds,
          };
        }

        // Misattribution: firm framing of Ali's personal/prior work.
        if (PARAMOUNT_FIRM_FRAMING_RE.test(sentence)) {
          return {
            ok: false,
            rule: 'ali_misattributed_as_firm',
            offendingAssertion: sentence.slice(0, 220),
            invalidSrcIds: chunks.map((c) => c.id),
            validSrcIds,
          };
        }

        // Quantified outcome grounded only in ali-* without case citation:
        // allow only when flag is off AND correctly attributed to Ali personally.
        if (!ALI_PERSONAL_ATTRIBUTION_RE.test(sentence)) {
          return {
            ok: false,
            rule: 'ali_metric_without_case',
            offendingAssertion: sentence.slice(0, 220),
            invalidSrcIds: chunks.map((c) => c.id),
            validSrcIds,
          };
        }
        if (suppressUnclearedClientMetrics() && jazzBykeaMetric) {
          return {
            ok: false,
            rule: 'suppressed_uncleared_client_metric',
            offendingAssertion: sentence.slice(0, 220),
            invalidSrcIds: chunks.map((c) => c.id),
            validSrcIds,
          };
        }
      }

      // Default-deny. No src class licenses a delivered-outcome claim without a
      // case citation: paramount-positioning and an unclassified (null) chunk are
      // neither ali-* nor paramount-delivery-outcome, so without this the sentence
      // would ship on a service/about page metric. Ali-backed claims are handled
      // above, where correct personal attribution is allowed to pass.
      if (!aliBacked && DELIVERED_OUTCOME_CLAIM_RE.test(sentence)) {
        return {
          ok: false,
          rule: 'unsourced_delivery_outcome',
          offendingAssertion: sentence.slice(0, 220),
          invalidSrcIds: chunks.map((c) => c.id),
          validSrcIds,
        };
      }
    }

    // Firm framing of ali-* personal claims (even without metrics).
    const aliOnly = chunks.every(
      (c) =>
        c.attributionClass === 'ali-personal-contract' ||
        c.attributionClass === 'ali-prior-employment',
    );
    if (aliOnly && chunks.length > 0 && PARAMOUNT_FIRM_FRAMING_RE.test(sentence)) {
      return {
        ok: false,
        rule: 'ali_misattributed_as_firm',
        offendingAssertion: sentence.slice(0, 220),
        invalidSrcIds: chunks.map((c) => c.id),
        validSrcIds,
      };
    }
  }

  return { ok: true, strippedText: stripSrcTokens(replyText) };
}

export function buildSrcRegenerateFeedback(
  failure: Extract<SrcValidationResult, { ok: false }>,
): string {
  const validList =
    failure.validSrcIds.length > 0
      ? failure.validSrcIds.map((id) => `[[src:${id}]]`).join(', ')
      : '(none — call search_company_info and only cite IDs returned above the relevance floor)';

  switch (failure.rule) {
    case 'missing_src_token':
      return (
        `Your last reply made a specific founder/company claim without a valid [[src:CHUNK_ID]] token. ` +
        `Offending assertion: "${failure.offendingAssertion}". ` +
        `Attach a current-turn [[src:ID]] from: ${validList}. ` +
        `These tokens are INTERNAL — they are stripped before the user sees the reply, so you MUST still include them. ` +
        `Copy the exact citation field from the tool result onto the claim sentence. ` +
        `If you lack a retrieved source, do not invent details — say you don't have that detail on file and offer Ali at ${APPROVED_CONTACTS.ali.email}.`
      );
    case 'cross_namespace_src':
      return (
        `You used a case ID inside [[src:…]]. The src and case namespaces never cross. ` +
        `Use [[src:CHUNK_ID]] only for ContentChunk IDs from search_company_info. Valid src IDs: ${validList}.`
      );
    case 'unknown_src_id':
    case 'stale_or_below_floor_src':
      return (
        `Your [[src:…]] citation(s) ${failure.invalidSrcIds.join(', ')} were not retrieved above floor this turn. ` +
        `Valid src IDs: ${validList}. Remove or correct them; do not invent founder/company facts.`
      );
    case 'unsourced_delivery_outcome':
      return (
        `You stated a delivered outcome with a metric, grounded only in general company ` +
        `positioning content. Positioning sources cannot license a delivery claim. ` +
        `Offending assertion: "${failure.offendingAssertion}". ` +
        `Either retrieve the real case via search_cases and cite [[case:ID]], or describe ` +
        `the capability without the metric.`
      );
    case 'non_assertable_src':
    case 'delivery_outcome_without_case':
      return (
        `You asserted a Paramount delivered outcome from a non-case company source. ` +
        `Specific delivered Paramount outcomes require a valid [[case:ID]] from search_cases, not [[src]]. ` +
        `Remove the metric claim or retrieve and cite a real case.`
      );
    case 'ali_misattributed_as_firm':
      return (
        `You framed Ali's personal or prior work as Paramount firm experience. ` +
        `Attribute personal engagements to Ali explicitly, or retrieve Paramount cases via search_cases. ` +
        `Do not present Schneider/Syngenta/Toptal/etc. contracts as the firm's track record.`
      );
    case 'ali_metric_without_case':
      return (
        `A quantified delivered outcome grounded only in Ali's personal/prior bio is not valid as firm delivery. ` +
        `Either attribute it clearly as Ali's personal background (no Paramount framing) or cite a real [[case:ID]].`
      );
    case 'deanon_employer_case_bridge':
      return (
        `Do not use founder employer names (Jazz/Bykea/Daraz/Toptal) to identify or confirm a confidential case client. ` +
        `Keep founder employment and case evidence separate.`
      );
    case 'suppressed_uncleared_client_metric':
      return (
        `Public Jazz/Bykea metrics are currently suppressed (SUPPRESS_UNCLEARED_CLIENT_METRICS). ` +
        `You may state Ali's role/title/employer/dates, but do not ship those uncleared client metrics. ` +
        `If asked for numbers you cannot share, offer Ali at ${APPROVED_CONTACTS.ali.email}.`
      );
    default:
      return (
        `Founder/company grounding failed (${failure.rule}). Valid src IDs: ${validList}. ` +
        `Do not invent specifics; offer Ali at ${APPROVED_CONTACTS.ali.email} if needed.`
      );
  }
}

/**
 * When suppress flag is on, strip Jazz/Bykea metric-bearing achievement lines
 * from a chunk body before projecting to the model.
 */
export function maybeSuppressMetricLinesInSnippet(
  content: string,
  employer: string | null,
): string {
  if (!suppressUnclearedClientMetrics()) return content;
  const emp = employer ?? '';
  if (!/bykea|jazz/i.test(emp) && !/bykea|jazz/i.test(content.slice(0, 200))) {
    return content;
  }
  const lines = content.split('\n');
  const kept = lines.filter((line) => {
    if (!JAZZ_BYKEA_METRIC_RE.test(line)) return true;
    // Keep role header lines (Company/Title/Dates) even if they mention scale.
    if (/^(?:Person|Company|Title|Dates|Location|Employment type):/i.test(line)) {
      return true;
    }
    return false;
  });
  return kept.join('\n');
}
