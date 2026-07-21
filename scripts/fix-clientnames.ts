/**
 * Targeted fix: replace 2 junk clientName values (from the placeholder audit).
 * Updates ONLY the two ids below, ONLY the clientName field.
 *
 * 1. Fill in the two TODO constants below — the script refuses to run while
 *    either is still the placeholder.
 * 2. npx tsx --env-file=.env.local scripts/fix-clientnames.ts
 *
 * NOT touched here (goes to Ali): the "XX parent organization" case
 * (cmrm1dml7000l10mz647foq9m) and the three judgment-call clientNames.
 */
import { prisma } from '../lib/db';

const TODO = '<FILL ME IN>';

type Replacement = {
  id: string;
  caseTitle: string;
  expectedCurrent: string;
  newClientName: string;
};

// ============================================================================
// TODO: fill in the replacement descriptors (supplied by you, not invented)
// ============================================================================
const REPLACEMENTS: Replacement[] = [
  {
    id: 'cmrkz4kef000510mzesog028o',
    caseTitle: 'Pricing Intelligence and Recommendation Engine',
    expectedCurrent: 'MSA Project Team',
    newClientName: TODO,
  },
  {
    id: 'cmrl6phu9000d10mzlpm0uk3e',
    caseTitle: 'AI Powered Hiring and Candidate Assessment System',
    expectedCurrent: 'Fast Scaling Operations Driven Organization',
    newClientName: TODO,
  },
];
// ============================================================================

async function main() {
  // Refuse to write a placeholder over a placeholder
  const unfilled = REPLACEMENTS.filter(
    (r) => r.newClientName === TODO || !r.newClientName.trim(),
  );
  if (unfilled.length > 0) {
    console.error('REFUSING TO RUN — replacement value(s) not filled in yet for:');
    for (const r of unfilled) {
      console.error(`  - ${r.caseTitle} (${r.id})`);
    }
    console.error('\nEdit the REPLACEMENTS block at the top of this script first.');
    process.exitCode = 1;
    return;
  }

  for (const r of REPLACEMENTS) {
    const current = await prisma.caseStudy.findUnique({
      where: { id: r.id },
      select: { id: true, title: true, clientName: true },
    });

    if (!current) {
      console.error(`SKIP — case not found: ${r.id} (${r.caseTitle})`);
      process.exitCode = 1;
      continue;
    }

    // Safety: only overwrite the exact junk value we audited. If the value
    // changed since the audit (e.g. already fixed), leave it alone.
    if (current.clientName !== r.expectedCurrent) {
      console.error(
        `SKIP — ${current.title} (${r.id}): current clientName is ` +
          `"${current.clientName}", expected "${r.expectedCurrent}". Not touching it.`,
      );
      process.exitCode = 1;
      continue;
    }

    await prisma.caseStudy.update({
      where: { id: r.id },
      data: { clientName: r.newClientName.trim() },
    });

    console.log(`UPDATED ${current.title} (${r.id})`);
    console.log(`  before: ${current.clientName}`);
    console.log(`  after : ${r.newClientName.trim()}`);
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
