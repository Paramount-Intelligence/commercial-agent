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
