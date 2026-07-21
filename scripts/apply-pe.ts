/**
 * APPLY PE DECISIONS — reads pe-review.csv after Ali has filled
 * ALI_CONFIRM_Y_N, and writes peBacked to the DB accordingly.
 *
 * Only rows where ALI_CONFIRM_Y_N is 'y' or 'n' are applied.
 * Blank rows are skipped (left as-is).
 *
 *   npx tsx scripts/apply-pe.ts          # dry run
 *   npx tsx scripts/apply-pe.ts --apply  # writes
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function parseCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? [];
    const unq = (s = '') => s.replace(/^"|"$/g, '').replace(/""/g, '"').trim();
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h.trim()] = unq(cells[i])));
    return row;
  });
}

async function main() {
  const rows = parseCsv('pe-review.csv');
  let setTrue = 0, setFalse = 0, skipped = 0;

  for (const r of rows) {
    const decision = (r['ALI_CONFIRM_Y_N'] || '').toLowerCase();
    const title = r['title'];
    if (decision !== 'y' && decision !== 'n') { skipped++; continue; }

    const value = decision === 'y';
    console.log(`${value ? 'TRUE ' : 'false'}  ${title}`);
    if (APPLY) {
      // match by title (unique in this corpus)
      await prisma.caseStudy.updateMany({ where: { title }, data: { peBacked: value } });
    }
    value ? setTrue++ : setFalse++;
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — true: ${setTrue}, false: ${setFalse}, skipped(blank): ${skipped}`);
  if (!APPLY) console.log('Re-run with --apply to write.');
}

main().finally(() => prisma.$disconnect());
