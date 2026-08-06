/**
 * Unit tests for founder/company [[src]] grounding + attribution licensing.
 * No DB, no model.
 *
 *   npx tsx scripts/test-src-grounding.ts
 */
import {
  COMPANY_SRC_SAFE_FALLBACK,
  buildSrcRegenerateFeedback,
  companyInfoSimilarityFloor,
  extractSrcIds,
  maybeSuppressMetricLinesInSnippet,
  sentenceHasSpecificFounderCompanyClaim,
  shouldActivateSrcGate,
  stripSrcTokens,
  suppressUnclearedClientMetrics,
  validateSrcGrounding,
  type AttributionClass,
  type RetrievedSrcChunk,
} from '../lib/agent/srcGrounding';
import {
  notifyJackieFailure,
  resetFailureAlertThrottleForTests,
} from '../lib/alerts/failureAlert';
import { validatePricingReply } from '../lib/agent/pricing';
import { classifyParamountContent } from '../lib/knowledge/attribution';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function chunk(
  id: string,
  opts: Partial<RetrievedSrcChunk> & { attributionClass?: AttributionClass | null } = {},
): RetrievedSrcChunk {
  return {
    id,
    sim: opts.sim ?? 0.72,
    attributionClass: opts.attributionClass ?? null,
    employer: opts.employer ?? null,
    startDate: opts.startDate ?? null,
    endDate: opts.endDate ?? null,
    sourceType: opts.sourceType ?? 'founder-bio',
    heading: opts.heading ?? 'test',
    content: opts.content ?? 'test content',
  };
}

function main() {
  console.log('=== PART 1: grounding gate ===\n');

  // Floor env default
  check(
    'P1 floor default is 0.45',
    companyInfoSimilarityFloor() === 0.45 ||
      Number(process.env.COMPANY_INFO_SIMILARITY_FLOOR) > 0,
  );

  // Gate activation: Baikeya misspelling
  check(
    'P1 Baikeya activates protected-entity gate',
    shouldActivateSrcGate({
      userMessage: 'What was Ali role in Baikeya?',
      replyText: 'He co-founded it.',
      usedSearchCompanyInfo: false,
    }),
  );

  // Empty retrieval + co-founded claim → reject
  {
    const r = validateSrcGrounding({
      replyText: 'Ali co-founded Bykea in 2022.',
      retrievedSrc: new Map(),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P1 empty retrieval + co-founded → missing_src_token',
      r.ok === false && r.rule === 'missing_src_token',
      r.ok === false ? r.rule : 'was ok',
    );
    if (r.ok === false) {
      const fb = buildSrcRegenerateFeedback(r);
      check(
        'P1 regenerate feedback offers Ali email',
        fb.includes('ali@paramountintelligence.co'),
      );
    }
  }

  // Accurate Bykea answer with valid src
  {
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
      startDate: 'Feb 2022',
      endDate: 'Sep 2023',
    });
    const map = new Map([[bykea.id, bykea]]);
    const r = validateSrcGrounding({
      replyText:
        'Ali worked at Bykea as Data Scientist I from Feb 2022 to Sep 2023 [[src:chunk-bykea]].',
      retrievedSrc: map,
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P1 accurate Bykea + valid [[src]] → ok',
      r.ok === true &&
        r.ok &&
        !r.strippedText.includes('[[src:') &&
        r.strippedText.includes('Data Scientist I'),
      r.ok ? r.strippedText.slice(0, 120) : JSON.stringify(r),
    );
  }

  // Specific claim, no token
  {
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
    });
    const r = validateSrcGrounding({
      replyText: 'Ali was Data Scientist I at Bykea.',
      retrievedSrc: new Map([[bykea.id, bykea]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P1 specific claim without src token → rejected',
      r.ok === false && r.rule === 'missing_src_token',
    );
  }

  // Token for chunk not retrieved
  {
    const r = validateSrcGrounding({
      replyText: 'Ali was Data Scientist I at Bykea [[src:not-retrieved]].',
      retrievedSrc: new Map(),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P1 src for non-retrieved chunk → unknown_src_id',
      r.ok === false && r.rule === 'unknown_src_id',
    );
  }

  // Cross-namespace: case ID inside [[src]]
  {
    const r = validateSrcGrounding({
      replyText: 'Ali worked at Bykea [[src:case-abc]].',
      retrievedSrc: new Map(),
      caseRetrievedIds: new Set(['case-abc']),
      validCaseIdsInReply: new Set(['case-abc']),
      gateActive: true,
    });
    check(
      'P1 case ID as [[src]] → cross_namespace_src',
      r.ok === false && r.rule === 'cross_namespace_src',
    );
  }

  // Strip all src tokens
  {
    const text =
      'Ali was Data Scientist I at Bykea [[src:chunk-bykea]]. Happy to share more.';
    const stripped = stripSrcTokens(text);
    check(
      'P1 stripSrcTokens removes all [[src:…]]',
      !stripped.includes('[[src:') &&
        stripped.includes('Data Scientist I') &&
        extractSrcIds(stripped).length === 0,
      stripped,
    );
  }

  // General characterization allowed
  {
    const r = validateSrcGrounding({
      replyText:
        'Paramount Intelligence helps complex organizations bring their operations into the Agentic Age.',
      retrievedSrc: new Map(),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check('P1 general characterization without token → allowed', r.ok === true);
  }

  // Regression: punctuation is not a metric. Observed prod failure — the claim
  // regex matched a bare comma, so any comma'd sentence demanded an [[src]].
  {
    const benign = [
      "I attempted to submit this to the team, but the system didn't let it go through on my end.",
      "I don't have a source on file to explain that system hiccup, so I won't speculate on it further.",
      'Hello there, how are you.',
      'Let me pass that along to Ali and Marty, and someone will reach out.',
      'Ali and Marty are the right people for that conversation.',
      'We can get started whenever you are ready in 2026.',
    ];
    const flagged = benign.filter((s) => sentenceHasSpecificFounderCompanyClaim(s));
    check(
      'P1 punctuation/no-metric prose is not a founder claim',
      flagged.length === 0,
      `flagged: ${JSON.stringify(flagged)}`,
    );

    const r = validateSrcGrounding({
      replyText: `Ali and Marty are the right people. ${benign[0]}`,
      retrievedSrc: new Map(),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P1 lead-handoff prose mentioning Ali/Marty → allowed (no false missing_src_token)',
      r.ok === true,
      r.ok === false ? `${r.rule}: ${r.offendingAssertion}` : '',
    );
  }

  // Non-regression on the same edit: real metrics/roles still register.
  {
    const claims = [
      'Ali was Data Scientist I at Bykea.',
      'Paramount reduced manual ticket routing by 57% for a client.',
      'Paramount has Fortune 500 experience through Schneider Electric.',
      'At Bykea, Ali contributed approximately $4M in additional profit margin.',
      'Ali joined Bykea in 2022.',
      'Ali worked at Bykea from Feb 2022 to Sep 2023.',
    ];
    const missed = claims.filter((s) => !sentenceHasSpecificFounderCompanyClaim(s));
    check(
      'P1 specific role/date/metric claims still detected',
      missed.length === 0,
      `missed: ${JSON.stringify(missed)}`,
    );
  }

  // Safe fallback text
  check(
    'P1 SAFE_FALLBACK mentions Ali email',
    COMPANY_SRC_SAFE_FALLBACK.includes('ali@paramountintelligence.co') &&
      COMPANY_SRC_SAFE_FALLBACK.includes("don't have that detail"),
  );

  // failureAlert fires when configured (kind accepted; no throw)
  {
    resetFailureAlertThrottleForTests();
    let threw = false;
    try {
      notifyJackieFailure({
        kind: 'src_grounding_rejected',
        reason: 'missing_src_token: test',
        debug: {
          query: 'role in Baikeya?',
          companyInfoHitCount: 0,
          topRelevanceScore: null,
          offendingAssertion: 'Ali co-founded Bykea',
          rule: 'missing_src_token',
        },
      });
    } catch {
      threw = true;
    }
    check('P1 notifyJackieFailure accepts src_grounding_rejected', !threw);
  }

  console.log('\n=== PART 2: attribution licensing ===\n');

  // Fortune 500 / Schneider as firm → reject
  {
    const schneider = chunk('chunk-schneider', {
      attributionClass: 'ali-personal-contract',
      employer: 'Schneider Electric',
    });
    const r = validateSrcGrounding({
      replyText:
        "Paramount has Fortune 500 experience through Schneider Electric [[src:chunk-schneider]].",
      retrievedSrc: new Map([[schneider.id, schneider]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P2 firm framing of Schneider contract → ali_misattributed_as_firm',
      r.ok === false && r.rule === 'ali_misattributed_as_firm',
      r.ok === false ? r.rule : 'was ok',
    );
  }

  // Correctly attributed personal claim → ok
  {
    const schneider = chunk('chunk-schneider', {
      attributionClass: 'ali-personal-contract',
      employer: 'Schneider Electric',
      startDate: 'May 2026',
      endDate: 'Jun 2026',
    });
    const r = validateSrcGrounding({
      replyText:
        'Ali worked with Schneider Electric as an independent consultant in May–Jun 2026 [[src:chunk-schneider]].',
      retrievedSrc: new Map([[schneider.id, schneider]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P2 Ali-attributed Schneider claim → ok',
      r.ok === true,
      r.ok === false ? r.rule : undefined,
    );
  }

  // paramount-delivery-outcome cannot license 57% without case
  {
    const delivery = chunk('chunk-delivery', {
      attributionClass: 'paramount-delivery-outcome',
      employer: 'Paramount Intelligence',
    });
    const r = validateSrcGrounding({
      replyText:
        'Paramount delivered a voice agent that reduced manual ticket routing by 57% [[src:chunk-delivery]].',
      retrievedSrc: new Map([[delivery.id, delivery]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P2 delivery-outcome src without case → rejected',
      r.ok === false &&
        (r.rule === 'non_assertable_src' ||
          r.rule === 'delivery_outcome_without_case'),
      r.ok === false ? r.rule : 'was ok',
    );
  }

  // Ali background at Bykea accurate
  {
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
    });
    const r = validateSrcGrounding({
      replyText:
        "Ali's background at Bykea: he was Data Scientist I [[src:chunk-bykea]].",
      retrievedSrc: new Map([[bykea.id, bykea]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check('P2 Ali Bykea background attributed correctly → ok', r.ok === true);
  }

  // Delivered metric grounded only in ali-* → rejected (firm-ish / no personal attribution path for bare metric as firm)
  {
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
    });
    // Force suppress off for this attribution class test of bare firm-ish metric
    const prev = process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = 'false';
    const r = validateSrcGrounding({
      replyText:
        'The work contributed approximately $4M in additional profit margin at Bykea [[src:chunk-bykea]].',
      retrievedSrc: new Map([[bykea.id, bykea]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    if (prev === undefined) delete process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    else process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = prev;
    check(
      'P2 ali-only quantified outcome without Ali attribution → rejected',
      r.ok === false &&
        (r.rule === 'ali_metric_without_case' ||
          r.rule === 'ali_misattributed_as_firm'),
      r.ok === false ? r.rule : 'was ok',
    );
  }

  // Valid [[case:ID]] + metric → PASSES (no false positive)
  {
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
    });
    const r = validateSrcGrounding({
      replyText:
        'That engagement reduced ticket volume by 50% [[case:case-real]].',
      retrievedSrc: new Map([[bykea.id, bykea]]),
      caseRetrievedIds: new Set(['case-real']),
      validCaseIdsInReply: new Set(['case-real']),
      gateActive: true,
    });
    check(
      'P2 quantified outcome with valid [[case:ID]] → passes',
      r.ok === true,
      r.ok === false ? r.rule : undefined,
    );
  }

  console.log('\n=== PART 2b: company-path default-deny (null/positioning) ===\n');

  // The hole: a service/about chunk is neither ali-* nor delivery-outcome, so the
  // class-keyed branches used to fall through and ship the metric.
  {
    const svc = chunk('chunk-service', {
      attributionClass: 'paramount-positioning',
      sourceType: 'service',
    });
    const r = validateSrcGrounding({
      replyText:
        'Paramount reduced manual ticket routing by 57% for a PE-backed client [[src:chunk-service]].',
      retrievedSrc: new Map([[svc.id, svc]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P2b positioning-class metric claim without case → unsourced_delivery_outcome',
      r.ok === false && r.rule === 'unsourced_delivery_outcome',
      r.ok === false ? r.rule : 'was ok (HOLE OPEN)',
    );
  }

  // Same for a legacy unclassified row.
  {
    const legacy = chunk('chunk-legacy', {
      attributionClass: null,
      sourceType: 'about',
    });
    const r = validateSrcGrounding({
      replyText:
        'Our automation work saved a client approximately $2M annually [[src:chunk-legacy]].',
      retrievedSrc: new Map([[legacy.id, legacy]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P2b null-class metric claim without case → unsourced_delivery_outcome',
      r.ok === false && r.rule === 'unsourced_delivery_outcome',
      r.ok === false ? r.rule : 'was ok (HOLE OPEN)',
    );
  }

  // Non-regression: the same sentence with a real case citation still ships.
  {
    const svc = chunk('chunk-service', {
      attributionClass: 'paramount-positioning',
      sourceType: 'service',
    });
    const r = validateSrcGrounding({
      replyText:
        'That engagement reduced manual ticket routing by 57% [[case:case-ops]] [[src:chunk-service]].',
      retrievedSrc: new Map([[svc.id, svc]]),
      caseRetrievedIds: new Set(['case-ops']),
      validCaseIdsInReply: new Set(['case-ops']),
      gateActive: true,
    });
    check(
      'P2b positioning metric WITH valid [[case:ID]] → passes',
      r.ok === true,
      r.ok === false ? r.rule : undefined,
    );
  }

  // Non-regression: capability copy with no metric is still assertable.
  {
    const svc = chunk('chunk-service', {
      attributionClass: 'paramount-positioning',
      sourceType: 'service',
    });
    const r = validateSrcGrounding({
      replyText:
        'Paramount Intelligence builds RAG systems and agentic workflows for enterprise operations [[src:chunk-service]].',
      retrievedSrc: new Map([[svc.id, svc]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P2b positioning capability claim without metric → passes',
      r.ok === true,
      r.ok === false ? r.rule : undefined,
    );
  }

  // Non-regression: rate-card prose must not read as a delivered outcome.
  {
    const svc = chunk('chunk-rates', {
      attributionClass: 'paramount-positioning',
      sourceType: 'admin-knowledge',
    });
    const r = validateSrcGrounding({
      replyText:
        'Implementation and build work runs $90-$200 per hour depending on seniority, and fractional engagements carry discounts of 10-30% [[src:chunk-rates]].',
      retrievedSrc: new Map([[svc.id, svc]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    check(
      'P2b rate-card prose grounded in positioning → passes (no pricing regression)',
      r.ok === true,
      r.ok === false ? r.rule : undefined,
    );
  }

  // Ingest classifier must agree with the gate about what a delivery claim is.
  check(
    'P2b classifier routes metric-bearing service copy → paramount-delivery-outcome',
    classifyParamountContent(
      'We reduced manual ticket routing by 57% for a PE-backed portfolio company.',
    ) === 'paramount-delivery-outcome',
  );
  check(
    'P2b classifier keeps capability copy → paramount-positioning',
    classifyParamountContent(
      'We build AI agents, RAG retrieval systems, and workflow automation for complex organizations.',
    ) === 'paramount-positioning',
  );
  check(
    'P2b classifier keeps rate-card copy → paramount-positioning',
    classifyParamountContent(
      'Implementation / Build work (AI Engineers through Team Leaders): $90-$200 per hour. Fractional engagements: discounts of 10-30%.',
    ) === 'paramount-positioning',
  );

  console.log('\n=== PART 3: de-anon + suppress + pricing ===\n');

  // De-anon bridge blocked
  {
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
    });
    const r = validateSrcGrounding({
      replyText:
        'The Ride-Hailing Optimization case client was actually Bykea [[case:case-ride]] [[src:chunk-bykea]].',
      retrievedSrc: new Map([[bykea.id, bykea]]),
      caseRetrievedIds: new Set(['case-ride']),
      validCaseIdsInReply: new Set(['case-ride']),
      retrievedCaseTitles: new Map([
        ['case-ride', 'Ride-Hailing Optimization'],
      ]),
      gateActive: true,
    });
    check(
      'P3 bio employer confirming case client → deanon blocked',
      r.ok === false && r.rule === 'deanon_employer_case_bridge',
      r.ok === false ? r.rule : 'was ok',
    );
  }

  // Suppress flag default true
  check(
    'P3 SUPPRESS_UNCLEARED_CLIENT_METRICS defaults true',
    suppressUnclearedClientMetrics() === true ||
      process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS === 'false',
  );

  // Metric lines stripped from snippet when suppress on
  {
    const prev = process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = 'true';
    const body = [
      'Company: Bykea',
      'Title: Data Scientist I',
      '- Pioneered a dynamic pricing engine contributing approximately $4M.',
      '- Engineered driver profiling.',
    ].join('\n');
    const out = maybeSuppressMetricLinesInSnippet(body, 'Bykea');
    if (prev === undefined) delete process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    else process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = prev;
    check(
      'P3 suppress strips Jazz/Bykea metric lines from snippet',
      !out.includes('$4M') &&
        !out.includes('dynamic pricing') &&
        out.includes('Data Scientist I'),
      out,
    );
  }

  // When suppress false, correctly attributed personal metric may ship
  {
    const prev = process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = 'false';
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
    });
    const r = validateSrcGrounding({
      replyText:
        'At Bykea, Ali contributed approximately $4M in additional profit margin [[src:chunk-bykea]].',
      retrievedSrc: new Map([[bykea.id, bykea]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    if (prev === undefined) delete process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    else process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = prev;
    check(
      'P3 suppress=false allows Ali-attributed Bykea metric',
      r.ok === true,
      r.ok === false ? r.rule : undefined,
    );
  }

  // When suppress true, same metric blocked
  {
    const prev = process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = 'true';
    const bykea = chunk('chunk-bykea', {
      attributionClass: 'ali-prior-employment',
      employer: 'Bykea',
    });
    const r = validateSrcGrounding({
      replyText:
        'At Bykea, Ali contributed approximately $4M in additional profit margin [[src:chunk-bykea]].',
      retrievedSrc: new Map([[bykea.id, bykea]]),
      caseRetrievedIds: new Set(),
      validCaseIdsInReply: new Set(),
      gateActive: true,
    });
    if (prev === undefined) delete process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS;
    else process.env.SUPPRESS_UNCLEARED_CLIENT_METRICS = prev;
    check(
      'P3 suppress=true blocks Bykea metric shipment',
      r.ok === false && r.rule === 'suppressed_uncleared_client_metric',
      r.ok === false ? r.rule : 'was ok',
    );
  }

  // Pricing gate does not engage on bio dollars / dynamic pricing
  {
    const r1 = validatePricingReply(
      'Tell me about Ali at Jazz',
      'At Jazz Ali helped generate approximately $2M in annual support cost savings.',
    );
    const r2 = validatePricingReply(
      'Tell me about Bykea',
      'Ali pioneered a dynamic pricing engine at Bykea.',
    );
    const r3 = validatePricingReply(
      'Bykea outcomes?',
      'That work contributed approximately $4M in additional profit margin.',
    );
    check(
      'P3 bio $2M does not enter commercial pricing gate',
      r1.ok === true && r1.discussed === false,
    );
    check(
      'P3 dynamic pricing engine does not enter commercial pricing gate',
      r2.ok === true && r2.discussed === false,
    );
    check(
      'P3 bio $4M does not enter commercial pricing gate',
      r3.ok === true && r3.discussed === false,
    );
  }

  console.log('\n' + '='.repeat(48));
  const total = passed + failed;
  console.log(
    failed === 0 ? `ALL PASSED (${passed})` : `FAILED ${failed} / ${total}`,
  );
  // Part tallies for the implementation report
  console.log(
    '(See PASS/FAIL labels: P1 = Part 1, P2 = Part 2, P3 = Part 3)',
  );
  if (failed > 0) process.exitCode = 1;
}

main();
