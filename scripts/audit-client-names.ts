/**
 * READ-ONLY audit of CaseStudy.clientName before surfacing it in recommendations.
 *
 *   npx tsx --env-file=.env.local scripts/audit-client-names.ts
 *
 * Prints every case (title, clientName, clientType, fundContext), then:
 *   1. count with non-null/non-empty clientName
 *   2. real-company vs generic-descriptor split (heuristic) + ambiguous flags
 *   3. count null/empty
 * plus the distinct clientName list for eyeballing. Changes NOTHING.
 */
import { prisma } from '../lib/db';

type Classification = 'real' | 'generic' | 'ambiguous';

const GENERIC_WORD_RE =
  /\b(enterprise|platform|marketplace|client|company|firm|provider|organization|organisation|business|startup|scale-?up)\b/i;

const CONFIDENTIAL_RE = /\b(confidential|undisclosed|anonymous|nda)\b/i;

/** "Flexagon", "Syngenta AG", "ACME & Co" — short, every word leads with a capital/digit. */
const PROPER_NOUN_RE =
  /^[A-Z0-9][A-Za-z0-9&.'\-]*(\s+(?:[A-Z0-9][A-Za-z0-9&.'\-]*|of|and|the|for|&)){0,3}$/;

function classify(name: string): { cls: Classification; reason: string } {
  const t = name.trim();

  if (CONFIDENTIAL_RE.test(t)) {
    return { cls: 'generic', reason: 'confidential/undisclosed marker' };
  }
  if (/^an?\s/i.test(t)) {
    return { cls: 'generic', reason: 'starts with "a/an"' };
  }

  const hasGenericWord = GENERIC_WORD_RE.test(t);
  const looksProperNoun = PROPER_NOUN_RE.test(t);

  if (hasGenericWord && !looksProperNoun) {
    return { cls: 'generic', reason: 'generic word, no proper-noun pattern' };
  }
  if (hasGenericWord && looksProperNoun) {
    return { cls: 'ambiguous', reason: 'generic word BUT proper-noun capitalization' };
  }
  if (looksProperNoun) {
    return { cls: 'real', reason: 'proper-noun pattern' };
  }
  return { cls: 'ambiguous', reason: 'no clear pattern' };
}

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: {
      title: true,
      clientName: true,
      clientType: true,
      fundContext: true,
    },
    orderBy: { title: 'asc' },
  });

  console.log(`=== ALL CASES (${cases.length}) ===\n`);
  for (const c of cases) {
    console.log(`  ${c.title}`);
    console.log(`    clientName:  ${c.clientName?.trim() || '(null/empty)'}`);
    console.log(`    clientType:  ${c.clientType?.trim() || '(null/empty)'}`);
    console.log(`    fundContext: ${c.fundContext?.trim() || '(null/empty)'}`);
  }

  const named = cases.filter((c) => c.clientName && c.clientName.trim() !== '');
  const unnamed = cases.length - named.length;

  const real: string[] = [];
  const generic: string[] = [];
  const ambiguous: Array<{ name: string; reason: string }> = [];

  const distinct = [...new Set(named.map((c) => c.clientName!.trim()))].sort();

  for (const name of distinct) {
    const { cls, reason } = classify(name);
    if (cls === 'real') real.push(name);
    else if (cls === 'generic') generic.push(name);
    else ambiguous.push({ name, reason });
  }

  console.log('\n=== COUNTS ===');
  console.log(`total cases:                ${cases.length}`);
  console.log(`1. non-empty clientName:    ${named.length}`);
  console.log(`3. null/empty clientName:   ${unnamed}  (would render no client)`);
  console.log(`distinct clientName values: ${distinct.length}`);

  console.log(`\n=== 2a. REAL company names (heuristic) — ${real.length} ===`);
  real.forEach((n) => console.log(`  ${n}`));

  console.log(`\n=== 2b. GENERIC descriptors (heuristic) — ${generic.length} ===`);
  generic.forEach((n) => console.log(`  ${n}`));

  console.log(`\n=== 2c. AMBIGUOUS — eyeball these — ${ambiguous.length} ===`);
  if (ambiguous.length === 0) console.log('  (none)');
  ambiguous.forEach((a) => console.log(`  ${a.name}   [${a.reason}]`));

  console.log('\n=== DISTINCT clientName values (full scan list) ===');
  distinct.forEach((n) => console.log(`  ${n}`));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
