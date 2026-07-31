/**
 * Marty-approved pricing source of truth.
 *
 * DELIBERATE GUARDRAIL REVERSAL — approved 2026-07-22:
 * Paramount may now share this rate card and the 10–30% discount RANGE.
 * The duration × utilization matrix remains intentionally withheld.
 *
 * Gate reframe (2026-08): the post-generation pricing gate activates ONLY when
 * a reply quotes Paramount's own commercial rates / fees / discounts /
 * engagement costs. Case outcomes ($2M savings, % reduction), experience,
 * capabilities, and money-adjacent product language do NOT enter the gate.
 */
export const APPROVED_PRICING = {
  approval: {
    approvedBy: 'Marty',
    approvedOn: '2026-07-22',
    exactDiscountMatrixMayBeShared: false,
  },
  talentPool: {
    levels: 6,
    hourlyUsd: { min: 90, max: 200 },
  },
  engagements: {
    strategyAdvisory: {
      hourlyUsd: { min: 150, max: 250 },
    },
    implementationBuild: {
      hourlyUsd: { min: 90, max: 200 },
      roles: 'AI Engineer through Team Leader',
    },
    fractionalOngoing: {
      baseRateDiscountPercent: { min: 10, max: 30 },
      factors: ['engagement duration', 'utilization'],
    },
    workshopTraining: {
      billing: 'Applicable approved hourly rates above',
    },
  },
} as const;

const APPROVED_DOLLAR_AMOUNTS = new Set([90, 150, 200, 250]);
const APPROVED_PERCENT_AMOUNTS = new Set([10, 30]);

/**
 * Product / case-study collocates that contain pricing-adjacent words but are
 * NOT Paramount commercial-rate discussion. Masked before the commercial gate
 * so titles like "Pricing Intelligence…" or "rate limiting" cannot false-positive.
 * Suffixes are REQUIRED — bare "pricing" / "rate" / "cost" stay eligible.
 */
const PRODUCT_DOMAIN_PRICING_PHRASE_RE =
  /\b(?:dynamic\s+)?pricing\s+(?:intelligence(?:\s+and\s+recommendation\s+engine)?|engines?|analytics|platforms?|systems?|models?|recommendation(?:\s+engines?)?|optimization|algorithms?|efficiency)\b|\bcost\s+(?:optimization|reduction|savings?|functions?|centers?)\b|\brate\s+limit(?:ing|ers?|s)?\b|\bfare\s+(?:optimization|pricing|engines?)\b/gi;

/**
 * Case-outcome / capability dollars — NOT Paramount rate-card quotes.
 * e.g. "$2M in annual support cost savings", "$300K annually", "$4M profit".
 */
const OUTCOME_DOLLAR_RE =
  /\$\s*[\d,]+(?:\.\d+)?\s*[KMB]\b|\$\s*[\d,]+(?:\.\d+)?(?=[\s\S]{0,80}\b(?:savings?|saved|gains?|profit(?:\s+margin)?|additional\s+profit|revenue|margin|annually|per\s+year|a\s+year|in\s+annual|unlocked|contributing|generating|eliminating)\b)/gi;

/**
 * Tight user-side: asking what Paramount charges (used only when there is no
 * reply yet — e.g. choosing a turn-failure fallback). Bare "cost" / "budget"
 * alone do NOT count.
 */
const USER_ASKS_COMMERCIAL_PRICING_RE =
  /\bwhat do you charge\b|\bcan i get a discount\b|\bany discount\b|\b(?:how much|what)\b[\s\S]{0,48}\b(?:(?:do|would|will|does|are|is)\s+)?(?:you|paramount|it|this|your)\b[\s\S]{0,24}\b(?:charge|cost|rate|rates|fee|fees|price|pricing|discount)\b|\b(?:your|paramount(?:'s)?)\s+(?:rates?|fees?|pricing|price|discounts?|rate card|retainer|commercial terms?)\b|\b(?:rate card|hourly rates?|commercial terms?)\b|\bwhat would it cost\b|\bwhat(?:'s| is) (?:your|the) (?:rate|price|fee|pricing)\b/i;

/**
 * Paramount commercial offer language in a reply — rates we charge, fees,
 * discounts, rate card / retainer / scoped quote. Never bare product nouns.
 * Applied AFTER product-phrase + outcome-$ masking.
 */
const REPLY_PARAMOUNT_COMMERCIAL_RE =
  /\$\s*\d|\b(?:our|paramount(?:'s)?)\s+(?:price|pricing|rates?|fees?|costs?)\b|\b(?:the)\s+(?:price|pricing|rates?|fees?)\s+is\b|\b(?:hourly|per hour|\/\s*hr|rate card|retainer|commercial terms?|formal scoped quote|binding quote)\b|\b(?:we\s+charge|engagement\s+costs?)\b|\b(?:we (?:offer|give)|offer(?:s|ing)?|available)\b[\s\S]{0,40}\bdiscounts?\b|\b\d+(?:\.\d+)?\s*%\s+discount\b|\bdiscounts?\s+(?:of|from|between|available)\b/i;

/** Mask product/case collocates so only commercial wording remains. */
export function stripProductDomainPricingPhrases(text: string): string {
  return text.replace(PRODUCT_DOMAIN_PRICING_PHRASE_RE, ' ');
}

/** Mask case-outcome / savings dollars so they cannot enter the commercial gate. */
export function stripOutcomeDollars(text: string): string {
  return text.replace(OUTCOME_DOLLAR_RE, ' ');
}

/**
 * Case-study / project outcome percentages — NOT Paramount commercial discounts.
 * e.g. "50% reduction", "30-50% faster", "deflected 30% of calls".
 * Masked before the percent-amount scan so legitimate metrics cannot false-positive.
 * Deliberately does NOT treat bare "50% less/off" as an outcome (that is commercial).
 */
const OUTCOME_METRIC_PERCENT_RE =
  /\b(?:up\s+to\s+|approximately\s+|about\s+|around\s+|roughly\s+|nearly\s+|over\s+|more\s+than\s+)?\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?\s*%(?:\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?\s*%)?\s*(?:reduction|improvement|increase|decrease|faster|slower|savings?|deflection|efficiency|productivity|accuracy|uptime|downtime|conversion|retention|churn|latency|throughput|effort|capacity|coverage|automation|adoption|satisfaction|nps|roi|cycle\s*times?|handle\s*times?|response\s*times?|calls?|tickets?|volume|incidents?|errors?|waste|cost\s+savings?|(?:more|less|higher|lower)\s+(?:effort|time|work|manual(?:\s+work)?|calls?|tickets?|volume|cost|costs|latency|errors?|waste|overhead))\b|\b(?:reduc(?:e[ds]?|tion)|improv(?:e[ds]?|ement)|increas(?:e[ds]?|ing)|decreas(?:e[ds]?|ing)|deflect(?:ed|s|ing|ion)?|sav(?:e[ds]?|ings?)|cut|boost(?:ed|s|ing)?|grew|lower(?:ed|s|ing)?|rais(?:e[ds]?|ing)|achiev(?:e[ds]?|ing))\b[\s\S]{0,48}\b\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?\s*%|\b\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?\s*%\s*(?:faster|slower)\b/gi;

/** True when a % figure sits in commercial discount / rate-card language. */
const COMMERCIAL_PERCENT_CONTEXT_RE =
  /\b\d+(?:\.\d+)?\s*%\s*(?:discount|off)\b|\b(?:discounts?|off)\b[\s\S]{0,28}\d+(?:\.\d+)?\s*%|\b(?:take|offer|give|charge)\b[\s\S]{0,40}\d+(?:\.\d+)?\s*%\s+less\b|\b\d+(?:\.\d+)?\s*%\s+less\b(?!\s+(?:effort|time|work|manual|calls?|tickets?|volume|errors?|waste|overhead|cost|costs))\b|\b(?:fees?|rates?|pricing|price|retainer|billing|quote)\b[\s\S]{0,28}\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*%[\s\S]{0,28}\b(?:fees?|rates?|pricing|price|retainer|billing|quote|discounts?)\b/i;

/**
 * Keep commercial discount phrasing intact; blank out case-outcome % spans.
 * Only suppress stripping when the % itself is discount/off/fee-bound — a later
 * "rates are $90…" in the same reply must not rescue "50% reduction".
 */
export function stripOutcomeMetricPercentages(text: string): string {
  return text.replace(OUTCOME_METRIC_PERCENT_RE, (match, ...rest) => {
    const offset = rest[rest.length - 2] as number;
    // Tight window: the metric phrase and its immediate neighbors only.
    const start = Math.max(0, offset - 12);
    const end = Math.min(text.length, offset + match.length + 12);
    const near = text.slice(start, end);
    if (
      /\b(?:discounts?|off)\b|\b\d+(?:\.\d+)?\s*%\s*(?:discount|off|less)\b/i.test(
        near,
      )
    ) {
      return match;
    }
    return ' ';
  });
}

/**
 * Window around a % match: only treat as a pricing figure when
 * discount/rate/fee language is nearby. Outcome metrics are already stripped.
 */
function isCommercialPricingPercent(
  text: string,
  matchIndex: number,
  matchLength: number,
): boolean {
  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(text.length, matchIndex + matchLength + 48);
  return COMMERCIAL_PERCENT_CONTEXT_RE.test(text.slice(start, end));
}

const INDICATIVE_RE = /\bindicative\b/i;
const SCOPING_RE =
  /\b(?:subject to scop(?:e|ing)|scoped per engagement|final pricing (?:is|will be) scoped|not (?:a )?(?:firm|binding) quote)\b/i;
const HANDOFF_RE =
  /\b(?:connect|introduce|speak|talk|follow up)\b[\s\S]{0,80}\bParamount(?: team)?\b|\bformal scoped quote\b/i;
const DISCOUNT_PROMISE_RE =
  /\b(?:guarantee(?:d)?|promise(?:d)?|you(?:'ll| will) (?:get|receive)|we(?:'ll| will) give you)\b[\s\S]{0,60}\bdiscount\b/i;
const EXACT_MATRIX_RE =
  /\b\d+\+?\s*(?:days?|weeks?|months?|hours?)\b[\s\S]{0,100}\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*%\b[\s\S]{0,100}\b\d+\+?\s*(?:days?|weeks?|months?|hours?)\b/i;

export const APPROVED_PRICING_PROMPT = `
## Approved pricing reference — source of truth

- Six-level talent pool: $90–$200 per hour. Do not invent the six individual level rates; only this approved overall range is available.
- Strategy / Advisory: $150–$250 per hour.
- Implementation / Build: $90–$200 per hour, from AI Engineer through Team Leader.
- Fractional / Ongoing: discounts of 10–30% are available on base rates, depending on engagement duration and utilization.
- Workshop / Training: billed at the applicable approved hourly rates above.
- Longer duration and higher utilization may support a discount within the approved 10–30% range, but exact terms are scoped per engagement.

The exact duration × utilization discount matrix is intentionally withheld. Never state, infer, calculate, or repeat an exact discount tied to a duration/utilization threshold. If asked, say: "The exact discount depends on your specific duration and utilization, which we scope with you directly."
`.trim();

export const APPROVED_PRICING_FALLBACK =
  "Our indicative rates are $90–$200 per hour across Paramount's six-level talent pool, $150–$250 per hour for Strategy and Advisory, and $90–$200 per hour for Implementation and Build from AI Engineer through Team Leader. Fractional and ongoing engagements may have discounts of 10–30% available based on duration and utilization, while workshops and training use the applicable hourly rates above. These figures are indicative, subject to scoping, and not a firm or binding quote; discounts are available rather than guaranteed. I can connect you with the Paramount team for a formal scoped quote.";

export type PricingValidationResult =
  | { ok: true; discussed: boolean }
  | { ok: false; discussed: true; reasons: string[] };

/** Prepare reply text for commercial-quote detection. */
function commercialReplySurface(replyText: string): string {
  return stripOutcomeDollars(stripProductDomainPricingPhrases(replyText));
}

/** True when the reply quotes Paramount rates / fees / discounts / engagement cost. */
export function replyQuotesParamountCommercialPricing(replyText: string): boolean {
  return REPLY_PARAMOUNT_COMMERCIAL_RE.test(commercialReplySurface(replyText));
}

/** True when the user is asking what Paramount charges (fallback selection only). */
export function userAsksCommercialPricing(userText: string): boolean {
  return USER_ASKS_COMMERCIAL_PRICING_RE.test(
    stripProductDomainPricingPhrases(userText),
  );
}

/**
 * Explain why pricing-mode engaged (for logs). Empty ⇒ gate should stay off.
 */
export function explainPricingDiscussionTrigger(
  userText: string,
  replyText = '',
): string[] {
  const triggers: string[] = [];
  if (replyText.trim()) {
    const surface = commercialReplySurface(replyText);
    for (const match of surface.matchAll(
      /\$\s*[\d,]+(?:\.\d+)?(?:\s*[KMB])?|\b(?:our|paramount(?:'s)?)\s+(?:price|pricing|rates?|fees?|costs?)\b|\b(?:hourly|per hour|\/\s*hr|rate card|retainer|commercial terms?|formal scoped quote|binding quote|we\s+charge|engagement\s+costs?)\b|\b(?:we (?:offer|give)|offer(?:s|ing)?|available)\b[\s\S]{0,40}\bdiscounts?\b|\b\d+(?:\.\d+)?\s*%\s+discount\b|\bdiscounts?\s+(?:of|from|between|available)\b/gi,
    )) {
      triggers.push(`reply:${match[0].replace(/\s+/g, ' ').trim().slice(0, 60)}`);
    }
    if (triggers.length === 0 && REPLY_PARAMOUNT_COMMERCIAL_RE.test(surface)) {
      triggers.push('reply:paramount-commercial-pattern');
    }
    return [...new Set(triggers)];
  }
  if (userAsksCommercialPricing(userText)) {
    triggers.push('user:asks-commercial-pricing');
  }
  return triggers;
}

/**
 * Gate entry. With a reply: ONLY Paramount commercial quotes in that reply.
 * With no reply (turn-failure fallback): user asked commercial pricing.
 */
export function isPricingDiscussion(userText: string, replyText = ''): boolean {
  if (replyText.trim()) {
    return replyQuotesParamountCommercialPricing(replyText);
  }
  return userAsksCommercialPricing(userText);
}

/**
 * Deterministic post-generation pricing gate. Prompt rules guide the model;
 * this validator prevents unsupported figures or under-framed pricing from
 * reaching the user if the model deviates.
 *
 * Does NOT run (discussed:false) for experience / case-outcome / capability
 * answers — even when they mention cost savings or dollar results.
 */
export function validatePricingReply(
  userText: string,
  replyText: string,
): PricingValidationResult {
  const discussed = isPricingDiscussion(userText, replyText);
  if (!discussed) return { ok: true, discussed: false };

  const reasons: string[] = [];
  // Dollar scan uses the commercial surface so outcome $2M etc. are ignored.
  const dollarSurface = commercialReplySurface(replyText);
  for (const match of dollarSurface.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)) {
    const amount = Number(match[1].replaceAll(',', ''));
    if (!APPROVED_DOLLAR_AMOUNTS.has(amount)) {
      reasons.push(`unapproved dollar amount $${match[1]}`);
    }
  }
  // Outcome metrics (case results) are stripped; remaining % figures are only
  // gated when they sit in commercial discount/rate language.
  const commercialReply = stripOutcomeMetricPercentages(replyText);
  for (const match of commercialReply.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const percent = Number(match[1]);
    const idx = match.index ?? 0;
    if (!isCommercialPricingPercent(commercialReply, idx, match[0].length)) {
      continue;
    }
    if (!APPROVED_PERCENT_AMOUNTS.has(percent)) {
      reasons.push(`unapproved percentage ${match[1]}%`);
    }
  }

  if (!INDICATIVE_RE.test(replyText)) {
    reasons.push('missing indicative framing');
  }
  if (!SCOPING_RE.test(replyText)) {
    reasons.push('missing scoping/non-binding framing');
  }
  if (!HANDOFF_RE.test(replyText)) {
    reasons.push('missing Paramount-team scoped-quote handoff');
  }
  if (EXACT_MATRIX_RE.test(replyText)) {
    reasons.push('exact duration/utilization discount threshold disclosed');
  }
  if (DISCOUNT_PROMISE_RE.test(replyText)) {
    reasons.push('discount presented as promised or guaranteed');
  }

  return reasons.length
    ? { ok: false, discussed: true, reasons: [...new Set(reasons)] }
    : { ok: true, discussed: true };
}

export function buildPricingRegenerateFeedback(reasons: string[]): string {
  return (
    'Your proposed pricing reply failed the approved-pricing gate: ' +
    `${reasons.join('; ')}. Use ONLY the approved pricing reference. ` +
    'Do not repeat an unapproved figure from the user. Include the word "indicative", ' +
    'state that final pricing is subject to scoping and is not a firm or binding quote, ' +
    'describe discounts only as 10–30% available based on duration and utilization (not guaranteed), ' +
    'withhold the exact matrix, and offer a Paramount-team handoff for a formal scoped quote.'
  );
}
