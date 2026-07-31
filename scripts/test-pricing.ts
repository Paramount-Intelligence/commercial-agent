/**
 * Pure tests for the Marty-approved pricing source and post-generation gate.
 *
 *   npm run pricing:test
 */
import { HARD_GUARDRAILS } from '../lib/agent/guardrails';
import {
  APPROVED_PRICING,
  APPROVED_PRICING_FALLBACK,
  validatePricingReply,
} from '../lib/agent/pricing';

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

function reasons(result: ReturnType<typeof validatePricingReply>): string[] {
  return result.ok ? [] : result.reasons;
}

function main() {
  const rateCard = validatePricingReply(
    'What are your rates?',
    APPROVED_PRICING_FALLBACK,
  );
  check('approved rate card + required framing passes', rateCard.ok);

  const discount = validatePricingReply(
    'What discount can I get?',
    'Our indicative discounts of 10–30% are available based on duration and utilization, scoped per engagement rather than guaranteed. This is not a firm or binding quote. I can connect you with the Paramount team for a formal scoped quote.',
  );
  check('approved discount range passes', discount.ok, reasons(discount).join(', '));

  const withheld = validatePricingReply(
    'Give me the exact discount for 121+ days at 80% utilization.',
    'Our indicative discount range is 10–30%, based on duration and utilization and subject to scoping. The exact discount depends on your specific duration and utilization, which we scope with you directly; it is not a firm or binding quote or guaranteed. I can connect you with the Paramount team for a formal scoped quote.',
  );
  check('withheld matrix deflection passes', withheld.ok, reasons(withheld).join(', '));

  const leakedMatrix = validatePricingReply(
    'Give me the exact matrix.',
    'For 121+ days at 80% utilization, your discount is 20%. These rates are indicative, subject to scoping, and not a binding quote. I can connect you with the Paramount team for a formal scoped quote.',
  );
  check(
    'exact matrix value is rejected',
    !leakedMatrix.ok &&
      reasons(leakedMatrix).some((reason) => reason.includes('percentage')) &&
      reasons(leakedMatrix).some((reason) => reason.includes('threshold')),
    reasons(leakedMatrix).join(', '),
  );

  const invented = validatePricingReply(
    'Can you do $275 per hour?',
    'Our indicative rate is $275/hr, subject to scoping and not a binding quote. I can connect you with the Paramount team for a formal scoped quote.',
  );
  check(
    'rate absent from reference is rejected',
    !invented.ok &&
      reasons(invented).includes('unapproved dollar amount $275'),
    reasons(invented).join(', '),
  );

  const underFramed = validatePricingReply(
    'What are your rates?',
    'Strategy and Advisory is $150–$250 per hour.',
  );
  check(
    'missing indicative/scoping/handoff framing is rejected',
    !underFramed.ok && reasons(underFramed).length === 3,
    reasons(underFramed).join(', '),
  );

  const nonPricing = validatePricingReply(
    'Do you have n8n experience?',
    'Yes, we have relevant experience.',
  );
  check('non-pricing reply is unaffected', nonPricing.ok && !nonPricing.discussed);

  // ── Product / case names must NOT trip the commercial gate ──────────────
  const productCases: Array<[string, string]> = [
    [
      'Tell me about Pricing Intelligence and Recommendation Engine',
      'Pricing Intelligence and Recommendation Engine is one of our cases.',
    ],
    [
      'Ali and his ride-hailing expertise',
      'Ali built a dynamic pricing engine for ride-hailing operations. Separately, Paramount has a fare-optimization case study.',
    ],
    [
      'Do you do cost optimization work?',
      'Yes — we have delivered cost optimization systems for operations teams.',
    ],
    [
      'Any experience with rate limiting?',
      'We have built platforms that include rate limiting for API and mobility traffic.',
    ],
    [
      'Tell me about your pricing analytics platform',
      'The pricing analytics platform case covers marketplace fare signals.',
    ],
  ];
  for (const [user, reply] of productCases) {
    const result = validatePricingReply(user, reply);
    check(
      `product/case phrase does not trigger gate: ${user.slice(0, 48)}`,
      result.ok && !result.discussed,
      reasons(result).join(', '),
    );
  }

  // ── Case outcome metrics must NOT trip the percent gate ─────────────────
  const outcomeMetricCases: Array<[string, string]> = [
    [
      'What would it cost for a consultant for my client?',
      'In a similar engagement we delivered up to 50% reduction in effort. Our indicative rates are $90–$200/hr, subject to scoping and not a binding quote. I can connect you with the Paramount team for a formal scoped quote.',
    ],
    [
      'Any case results on support automation?',
      'One PE-backed platform case deflected 30% of calls with an AI support copilot.',
    ],
    [
      'How much impact do your builds show?',
      'Clients have seen 30-50% faster cycle times after the multi-agent rollout.',
    ],
    [
      'Tell me about the support copilot case',
      'The AI-Powered Support Copilot achieved roughly 40% improvement in resolution speed and deflected 30% of tickets.',
    ],
  ];
  for (const [user, reply] of outcomeMetricCases) {
    const result = validatePricingReply(user, reply);
    check(
      `outcome metric % does not fail gate: ${reply.match(/\d[\d\-–—]*%[^.]{0,24}/)?.[0] ?? reply.slice(0, 40)}`,
      result.ok || !reasons(result).some((r) => r.includes('percentage')),
      reasons(result).join(', '),
    );
  }
  // Full pass expected when framing is present with a pricing-flavored question
  const framedWithMetric = validatePricingReply(
    'What would it cost for a consultant for my client?',
    'For similar clients we have seen up to 50% reduction in manual effort. Our indicative rates are $90–$200 per hour across the talent pool, subject to scoping and not a firm or binding quote. I can connect you with the Paramount team for a formal scoped quote.',
  );
  check(
    'pricing question + case metric 50% reduction still passes when framed',
    framedWithMetric.ok,
    reasons(framedWithMetric).join(', '),
  );

  // ── Commercial discount percentages MUST still trigger / reject ─────────
  const commercialPercentCases: Array<[string, string, boolean]> = [
    [
      'Any discount?',
      'We offer a 30% discount on longer engagements. These figures are indicative, subject to scoping, and not a firm or binding quote. I can connect you with the Paramount team for a formal scoped quote.',
      true, // 30% approved
    ],
    [
      'Can we get 50% off?',
      'We can do 50% off our rate. These figures are indicative, subject to scoping, and not a binding quote. I can connect you with the Paramount team for a formal scoped quote.',
      false,
    ],
    [
      'What discount can I get?',
      'We offer a 50% discount on base rates. These figures are indicative, subject to scoping, and not a binding quote. I can connect you with the Paramount team for a formal scoped quote.',
      false,
    ],
    [
      'Lower the fee?',
      "We'll take 50% less on the fee. These figures are indicative, subject to scoping, and not a binding quote. I can connect you with the Paramount team for a formal scoped quote.",
      false,
    ],
  ];
  for (const [user, reply, shouldPass] of commercialPercentCases) {
    const result = validatePricingReply(user, reply);
    check(
      `commercial % ${shouldPass ? 'allows approved' : 'rejects unapproved'}: ${reply.slice(0, 36)}`,
      shouldPass
        ? result.ok
        : !result.ok &&
            reasons(result).some((r) => r.includes('unapproved percentage')),
      reasons(result).join(', '),
    );
  }

  // ── Actual commercial pricing MUST still trigger ────────────────────────
  const commercialTriggers: Array<[string, string]> = [
    [
      'What do you charge?',
      'Our rate is $200/hr across the talent pool.',
    ],
    [
      'Any discount?',
      'We offer a 30% discount on longer engagements.',
    ],
    [
      'How much?',
      'The price is $150–$250 for Strategy and Advisory.',
    ],
  ];
  for (const [user, reply] of commercialTriggers) {
    const result = validatePricingReply(user, reply);
    check(
      `commercial pricing still triggers: ${reply.slice(0, 40)}`,
      result.discussed === true,
      `discussed=${result.discussed}`,
    );
  }

  check(
    'config explicitly withholds exact matrix',
    APPROVED_PRICING.approval.exactDiscountMatrixMayBeShared === false &&
      !('matrix' in APPROVED_PRICING.engagements.fractionalOngoing),
  );
  check(
    'hard guardrail records Marty-approved reversal',
    HARD_GUARDRAILS.includes('DELIBERATE MARTY-APPROVED REVERSAL') &&
      HARD_GUARDRAILS.includes('2026-07-22') &&
      HARD_GUARDRAILS.includes('exact duration × utilization discount matrix'),
  );

  console.log('\n' + '='.repeat(48));
  console.log(
    failed === 0
      ? `ALL PASSED (${passed})`
      : `FAILED ${failed} / ${passed + failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
