/**
 * PE-BACKED DETECTOR — scans title, subtitle, overview, client, clientName,
 * clientIndustry for private-equity signals, and proposes a peBacked value
 * for each case. It writes a CSV for Ali to confirm; it does NOT write to the DB.
 *
 *   npx tsx scripts/detect-pe.ts        # dry run, prints + writes pe-review.csv
 *   npx tsx scripts/detect-pe.ts --apply-confident   # writes only STRONG matches
 *
 * Ali confirms pe-review.csv, then you apply from it with apply-pe.ts (separate).
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';

const prisma = new PrismaClient();
const APPLY_CONFIDENT = process.argv.includes('--apply-confident');

// Strong = almost certainly PE-backed. Weak = worth a look, not conclusive.
const STRONG = [
  /\bPE[-\s]?backed\b/i,
  /private\s+equity/i,
  /portfolio\s+compan/i,
  /\bLBO\b/i,
  /buyout/i,
];
const WEAK = [
  /\bPE\b/,                 // bare "PE" — could be false positive
  /fund[-\s]?owned/i,
  /\bsponsor(ed)?\b/i,
  /value\s+creation/i,      // PE-speak, but not proof
  /\bportfolio\b/i,         // could just mean product portfolio
];

function scan(text: string, pats: RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of pats) {
    const m = text.match(p);
    if (m) hits.push(m[0]);
  }
  return hits;
}

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: {
      id: true, title: true, subtitle: true, overview: true,
      client: true, clientName: true, clientIndustry: true, peBacked: true,
    },
    orderBy: { title: 'asc' },
  });

  const rows: string[] = ['title,signal_strength,matched_terms,current_peBacked,PROPOSED_Y_N,ALI_CONFIRM_Y_N'];
  let strong = 0, weak = 0, none = 0;

  for (const c of cases) {
    const blob = [c.title, c.subtitle, c.overview, c.client, c.clientName, c.clientIndustry]
      .filter(Boolean).join(' \n ');

    const s = scan(blob, STRONG);
    const w = scan(blob, WEAK);

    let strength = 'NONE', proposed = '';
    if (s.length) { strength = 'STRONG'; proposed = 'y'; strong++; }
    else if (w.length) { strength = 'WEAK'; proposed = '?'; weak++; }
    else { none++; }

    const terms = [...new Set([...s, ...w])].join(' | ');
    rows.push([
      `"${c.title.replace(/"/g, '""')}"`,
      strength,
      `"${terms}"`,
      c.peBacked === null ? 'null' : String(c.peBacked),
      proposed,
      '',
    ].join(','));

    if (APPLY_CONFIDENT && strength === 'STRONG') {
      await prisma.caseStudy.update({ where: { id: c.id }, data: { peBacked: true } });
    }
  }

  writeFileSync('pe-review.csv', rows.join('\n'), 'utf8');

  console.log(`Cases: ${cases.length}`);
  console.log(`  STRONG (proposed peBacked = true): ${strong}`);
  console.log(`  WEAK   (needs Ali's judgement):    ${weak}`);
  console.log(`  NONE   (no signal — likely false): ${none}`);
  console.log(`\nWrote pe-review.csv — Ali fills ALI_CONFIRM_Y_N for every row.`);
  if (APPLY_CONFIDENT) console.log(`\n✓ Applied peBacked=true to ${strong} STRONG matches.`);
  else console.log(`\n(Nothing written to DB. Re-run with --apply-confident to auto-set STRONG matches.)`);

  console.log(`\n=== STRONG & WEAK matches ===`);
  const shown = rows.slice(1).filter(r => !r.includes(',NONE,'));
  shown.forEach(r => {
    const [title, strength, terms] = r.split(',');
    console.log(`  [${strength.padEnd(6)}] ${title.replace(/"/g, '')}  ->  ${terms.replace(/"/g, '')}`);
  });
}

main().finally(() => prisma.$disconnect());
