/**
 * Marty-approved pricing source of truth.
 *
 * DELIBERATE GUARDRAIL REVERSAL — approved 2026-07-22:
 * Paramount may now share this rate card and the 10–30% discount RANGE.
 * The duration × utilization matrix remains intentionally withheld.
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
const PRICING_TERMS_RE =
  /\b(?:price|pricing|rate|rates|cost|costs|fee|fees|budget|quote|discount|charges?|billing|retainer|commercial terms?)\b|\bhow much\b/i;
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

export function isPricingDiscussion(userText: string, replyText = ''): boolean {
  return PRICING_TERMS_RE.test(userText) || PRICING_TERMS_RE.test(replyText);
}

/**
 * Deterministic post-generation pricing gate. Prompt rules guide the model;
 * this validator prevents unsupported figures or under-framed pricing from
 * reaching the user if the model deviates.
 */
export function validatePricingReply(
  userText: string,
  replyText: string,
): PricingValidationResult {
  const discussed = isPricingDiscussion(userText, replyText);
  if (!discussed) return { ok: true, discussed: false };

  const reasons: string[] = [];
  for (const match of replyText.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)) {
    const amount = Number(match[1].replaceAll(',', ''));
    if (!APPROVED_DOLLAR_AMOUNTS.has(amount)) {
      reasons.push(`unapproved dollar amount $${match[1]}`);
    }
  }
  for (const match of replyText.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const percent = Number(match[1]);
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
