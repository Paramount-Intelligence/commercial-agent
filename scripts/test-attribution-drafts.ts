/**
 * Phase 3a: the drafts the attribution and contact gates rejected on the
 * conversation eval (22 Oct 2026), each with its correct counterpart. Correct
 * answers must pass; client framing, firm delivery, any case next to a former
 * employer and unapproved contacts must still fail. No DB, no model.
 *
 *   npx tsx scripts/test-attribution-drafts.ts
 */
import { validateContactReply } from '../lib/agent/contacts';
import { repairPricingFraming, validatePricingReply } from '../lib/agent/pricing';
import { dropOffendingSentences, replySentences } from '../lib/agent/responseSalvage';
import { validateSrcGrounding, type RetrievedSrcChunk } from '../lib/agent/srcGrounding';
import { validateCitations } from '../lib/agent/validator';
import { personaFallback } from '../lib/agent/fallbacks';
import { filterBuyerText } from '../lib/safety/buyerOutput';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (cond) passed++;
  else failed++;
}

const bykea: RetrievedSrcChunk = {
  id: 'founder-background-bykea',
  sim: 0.7,
  attributionClass: 'ali-prior-employment',
  employer: 'Bykea',
  startDate: '2022',
  endDate: '2023',
  sourceType: 'founder-bio',
  heading: 'Bykea',
  content: 'Ali worked at Bykea as a Data Scientist.',
};
const CASE = 'dynamic-pricing-ride-hailing';
const TITLE = 'Dynamic pricing for a ride-hailing platform';

function src(replyText: string, cited: string[] = []) {
  return validateSrcGrounding({
    replyText,
    retrievedSrc: new Map([[bykea.id, bykea]]),
    caseRetrievedIds: new Set([CASE]),
    validCaseIdsInReply: new Set(cited),
    retrievedCaseTitles: new Map([[CASE, TITLE]]),
    gateActive: true,
    restrictedEmployers: ['Bykea', 'Jazz', 'JazzCash'],
  });
}
const rule = (r: ReturnType<typeof src>) => (r.ok ? 'ok' : r.rule);
/** Pipeline outcome: the gate rejects the draft, or the buyer-output backstop removes the employer from it. */
const blocked = (text: string) => !src(text).ok || !/bykea/i.test(filterBuyerText(text, { formerEmployers: ['Bykea', 'Jazz', 'JazzCash'] }).split(/(?<=[.!?;])s+/)[0]);

// ——— Former employer: correct answers pass ———
{
  // q13 retry, rejected as ali_misattributed_as_firm on "a Paramount client".
  const r = src(
    'Before founding Paramount, Ali worked at Bykea, a ride-hailing and logistics platform, as a Data Scientist from 2022 to 2023. [[src:founder-background-bykea]] Bykea is not a Paramount client, and this is his personal career background.',
  );
  check('q13 retry: prior employment plus "not a Paramount client" passes', r.ok, rule(r));
}
{
  // q15 retry, rejected as ali_misattributed_as_firm.
  const r = src(
    "Bykea isn't a Paramount client — before founding Paramount, Ali worked there as a Data Scientist (2022–2023) on fraud detection and demand forecasting, but that's his personal career history. [[src:founder-background-bykea]]",
  );
  check('q15 retry: "isn\'t a Paramount client" with prior employment passes', r.ok, rule(r));
}
{
  const r = src(
    'There are no Paramount cases connected to Bykea. Ali worked at Bykea before founding Paramount. [[src:founder-background-bykea]]',
  );
  check('"no Paramount cases connected to Bykea" passes', r.ok, rule(r));
}
{
  const r = src('Paramount has no case for Bykea; Ali worked there before founding Paramount. [[src:founder-background-bykea]]');
  check('"Paramount has no case for Bykea" passes', r.ok, rule(r));
}

// ——— Former employer: wrong answers still fail ———
{
  check('denial followed by "we built their pricing engine for Bykea" is blocked', blocked("Bykea isn't a Paramount client, but we built the pricing engine for Bykea."));
}
{
  check('"Bykea is a Paramount client" is blocked', blocked('Bykea is a Paramount client.'));
  const q14 = src('Jazz itself is not a Paramount client, and that work is separate from what we deliver. [[src:founder-background-bykea]]');
  check('q14 (local draft): "separate from what we deliver" passes', q14.ok, rule(q14));
  check('"Bykea was our client" is blocked', blocked('Bykea was our client for the pricing work.'));
}
{
  const r = src('Paramount delivered pricing work for Bykea, where Ali worked as a Data Scientist. [[src:founder-background-bykea]]');
  check('"Paramount delivered … for Bykea" fails', !r.ok && r.rule === 'ali_misattributed_as_firm', rule(r));
}
{
  // q15 first draft: a denial plus a case in the same reply is still a link to the employer.
  const reply = `There are no Paramount cases connected to Bykea. Ali worked there before founding Paramount. [[src:founder-background-bykea]] For mobility work, see our ${TITLE} case [[case:${CASE}]].`;
  const r = src(reply, [CASE]);
  check('q15 first: a case cited next to Bykea fails (deanon_employer_case_bridge)', !r.ok && r.rule === 'deanon_employer_case_bridge', rule(r));
  check(
    'q15 first: the bridge names the case sentence, not the denial',
    !r.ok && r.offendingAssertion.includes(`[[case:${CASE}]]`) && !r.offendingAssertion.startsWith('There are no'),
    r.ok ? 'ok' : r.offendingAssertion,
  );
  if (!r.ok) {
    const salvaged = dropOffendingSentences(reply, [r.offendingAssertion]);
    const after = src(salvaged);
    check('q15 first: dropping the case sentence leaves a passing denial', after.ok && /no Paramount cases connected to Bykea/.test(salvaged), salvaged);
  }
}
{
  const r = src(`Separately, the ${TITLE} work came from Bykea.`);
  check('a case title linked to Bykea without a tag fails', !r.ok && r.rule === 'deanon_employer_case_bridge', rule(r));
}
{
  // q13 first draft: the metrics from that role stay suppressed.
  const r = src(
    'Some representative outcomes noted from that period at Bykea: a dynamic pricing engine tied to $4M+ in profit improvement and driver profiling linked to about 30% higher partner income. [[src:founder-background-bykea]]',
  );
  check('q13 first: Bykea metrics still fail (suppressed_uncleared_client_metric)', !r.ok && r.rule === 'suppressed_uncleared_client_metric', rule(r));
  check('q13 first: an unapproved dollar figure still fails pricing', !validatePricingReply('Walk me through the Bykea years.', 'It was tied to $14,000 a month.').ok);
}

// ——— Paraphrased case next to a former employer (q41 shipped one) ———
{
  const background = 'Before founding Paramount, Ali worked at Bykea as a Data Scientist from 2022 to 2023. [[src:founder-background-bykea]]';
  const r = src(`${background} It's pricing-intelligence work, but a different industry and a genuine Paramount delivery, not connected to Ali's Bykea history.`);
  check('q41: a paraphrased Paramount delivery next to Bykea fails', !r.ok && r.rule === 'deanon_employer_case_bridge', rule(r));
  const r2 = src(`${background} Our closest delivery work is a pricing engine for a manufacturer.`);
  check('a positive mention of our delivery work in a Bykea reply fails', !r2.ok && r2.rule === 'deanon_employer_case_bridge', rule(r2));
  const meta = src(`${background} On the "related Paramount cases" side, I don't have any case evidence to point to, so I won't imply a connection to his Bykea work.`);
  check('q41 (local draft): a meta sentence with a denial passes', meta.ok, rule(meta));
  for (const [name, tail] of [
    ['q11 (staging draft): "Happy to point you to a relevant Paramount case"', "Happy to point you to a relevant Paramount case in mobility if that's the work you're sizing up."],
    ['q42 (staging draft): "I\'d need to search our engagement history"', "For a ride-hailing case Paramount delivered, I'd need to search our engagement history."],
    ['a refusal to present them as cases', "I won't present those as Paramount case studies."],
    ['an offer to search', 'If you want, I can look for other confirmed Paramount cases in fraud detection.'],
    ['"we have no engagements"', 'We have no engagements connected to Bykea.'],
    ['"none of our projects"', 'None of our projects involved Bykea.'],
  ] as const) {
    const ok = src(`${background} ${tail}`);
    check(`q41: ${name} passes`, ok.ok, rule(ok));
  }
  const reply = `${background} The closest one is ${TITLE}. It's pricing-intelligence work and a genuine Paramount delivery, not connected to Bykea.`;
  let salvaged = reply;
  for (let i = 0; i < 4; i++) {
    const v = src(salvaged);
    if (v.ok) break;
    salvaged = dropOffendingSentences(salvaged, [v.offendingAssertion]);
  }
  check('q41: repeated salvage drops every bridging sentence and keeps the background', src(salvaged).ok && salvaged.startsWith('Before founding Paramount') && !/genuine|closest/i.test(salvaged), salvaged);
}

// ——— Uncited outcome figures (q08, staging run 2) ———
{
  const q08 = src(
    'We have relevant Salesforce and CRM work. The closest example is sales-enablement voice agents that routed prospects into the CRM - that unlocked about $500K in incremental revenue. Want to hear how that worked?',
  );
  check('q08: an outcome figure with no case or source anywhere fails', !q08.ok && q08.rule === 'unsourced_delivery_outcome', rule(q08));
  const cited = src(`We built ${TITLE}, which improved margins by 12%. [[case:${CASE}]]`, [CASE]);
  check('the same kind of figure with its case cited passes this rule', cited.ok || cited.rule !== 'unsourced_delivery_outcome', rule(cited));
  const rates = src('Delivery is $90-$200 an hour and advisory $150-$250, with a 10%-30% discount.');
  check('rate-card figures are not an outcome claim', rates.ok, rule(rates));
}

// ——— Contacts (q21) ———
{
  const ask = "Can I get a number to call Ali on?";
  const good = "We don't share a phone number for Ali; email him at ali@paramountintelligence.co. If you'd rather talk by phone, Marty is on 443.494.9144.";
  check('q21: Ali email plus Marty\'s number attributed to Marty passes', validateContactReply(ask, good).ok);
  check('q21: Ali email only passes', validateContactReply(ask, 'You can reach Ali at ali@paramountintelligence.co; we do not share his phone number.').ok);
  check('q21: Marty\'s number presented as Ali\'s fails', !validateContactReply(ask, "Ali's number is 443.494.9144.").ok);
  check('q21: an unattributed number fails', !validateContactReply(ask, 'Call 443.494.9144 any time.').ok);
  check('q21: a sentence naming Ali and the number fails', !validateContactReply(ask, 'You can reach Ali or Marty on 443.494.9144.').ok);
  check(
    'q21 (retry draft): "Marty Kaufman\'s number is …, before looping Ali in" passes',
    validateContactReply(ask, "If a phone contact is what you need, Marty Kaufman's number is 443.494.9144, and he's a great first stop before looping Ali in on technical details.").ok,
  );
  check('q21: "Marty or Ali at 443…" fails', !validateContactReply(ask, 'Call Marty or Ali at 443.494.9144.').ok);
  check('q21: any other number fails', !validateContactReply(ask, "Marty's line is 410.555.0101.").ok);
  check('an unapproved email fails', !validateContactReply('Best way to get hold of Ali?', 'Write to ali@gmail.com.').ok);
}

// ——— Pricing caveat repair (q18) ———
{
  const ask = 'Roughly what would you charge?';
  const draft = 'Our rates are $90-$200 an hour for implementation and $150-$250 for advisory work, with a 10%-30% discount possible for fractional or ongoing engagements.';
  const fixed = repairPricingFraming(ask, draft);
  check('q18: approved figures missing only the caveat get it appended', fixed !== null && validatePricingReply(ask, fixed).ok, fixed ?? 'null');
  const q18 =
    'Our indicative rates are $90-$200 per hour for delivery and $150-$250 for advisory work. For fractional or ongoing engagements, we offer a 10-30% discount depending on your duration and utilization. Everything is subject to scoping. Want to discuss your specific need with the team for a formal quote?';
  const q18fixed = repairPricingFraming(ask, q18);
  check(
    'q18 (local draft): only the handoff is added, replacing the weak closing question',
    q18fixed !== null && validatePricingReply(ask, q18fixed).ok && !q18fixed.includes('Want to discuss') && (q18fixed.match(/subject to scoping/g) ?? []).length === 1,
    q18fixed ?? 'null',
  );
  check('an unapproved figure is never repaired', repairPricingFraming(ask, 'Our rate is $350 an hour.') === null);
  const priceSentence = 'Our indicative rates are $90–$200 an hour for implementation and delivery, and $150–$250 for advisory work, with a 10–30% discount.';
  const ps = src(priceSentence);
  check('q18: an approved rate-card sentence needs no [[src]] tag', ps.ok, rule(ps));
  const spoken = src('We work at three levels: $90 to $200 an hour for build work, $150 to $250 for advisory, and a 10 to 30 percent discount is available for fractional work.');
  check('q18 (staging draft): rate-card figures written as "10 to 30 percent" need no [[src]]', spoken.ok, rule(spoken));
  const odd = src('Ali delivered a 45% improvement at Bykea.');
  check('a non-rate-card figure still needs its source', !odd.ok, rule(odd));
  check('"connecting with the Paramount team" counts as the handoff', validatePricingReply(ask, `${priceSentence} These are indicative and subject to scoping; I'd recommend connecting with the Paramount team for a formal quote.`).ok);
  check('a discount promise is never repaired', repairPricingFraming(ask, 'We guarantee you a 30% discount on $90-$200 an hour.') === null);
}

// ——— Sentence splitting for salvage ———
{
  const text = 'Email ali@paramountintelligence.co for details. Marty is on 443.494.9144. Rates start at 2.5 times cost.';
  const parts = replySentences(text);
  check('emails, phone numbers and decimals stay inside their sentence', parts.length === 3 && parts[0].includes('ali@paramountintelligence.co') && parts[1].includes('443.494.9144'), JSON.stringify(parts));
  check('a leading citation tag stays with the sentence it cites', replySentences('We built it. [[case:x]] Next we scaled it.')[0] === 'We built it. [[case:x]]');
  check('a short fragment never drops other sentences', dropOffendingSentences('We build AI systems. We built one for Bykea.', ['co']) === 'We build AI systems. We built one for Bykea.');
  const cites = validateCitations('See ali@paramountintelligence.co. We built X [[case:zzz]].', new Set(['a']), new Map());
  check('citation spans do not break inside an email', !cites.ok && cites.offendingSentences.length === 1 && cites.offendingSentences[0].sentence.startsWith('We built X'), JSON.stringify(cites.ok ? null : cites.offendingSentences));
}

// ——— Fallbacks never use the old fixed sentence ———
{
  const user = { name: 'Jane Doe', email: 'jane@example.com', affiliation: 'Acme' };
  const texts = (['general', 'company', 'pricing', 'contact', 'lead', 'document', 'overload'] as const).flatMap((t) =>
    ['', 'Did you build the pricing engine for Bykea as a client?', "Can I get a number to call Ali on?"].flatMap((q) => {
      const seen: string[] = [];
      for (let i = 0; i < 5; i++) seen.push(personaFallback(t, seen, user, q));
      return seen;
    }),
  );
  check('no persona fallback says "I don\'t have that detail on file"', texts.every((t) => !/detail on file/i.test(t)));
  check('no persona fallback names Jackie', texts.every((t) => !/jackie/i.test(t)));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
