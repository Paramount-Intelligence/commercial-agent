/**
 * STEP 1 (merge-preserving) — Extract candidate technology names from
 * CaseStudy.tech, but PRESERVE any canonicalization already done.
 *
 * If tech-candidates.csv already exists, its CANONICAL_NAME / KEEP_Y_N values
 * are carried forward. Only genuinely NEW candidates appear blank. This makes
 * the enrichment loop safe to run forever:
 *
 *   1. add/enrich cases
 *   2. npx tsx scripts/extract-tech-candidates.ts   <- only new rows are blank
 *   3. fill the few new blanks
 *   4. npx tsx scripts/backfill-casetech.ts --apply
 *
 * Existing decisions are never lost. A backup (.bak) is written each run.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';

const prisma = new PrismaClient();
const CSV = 'tech-candidates.csv';
const PROSE_WORD_LIMIT = 4;

function splitCandidates(desc: string): string[] {
  return desc
    .split(/[\n\r]+|[•·]|(?:^|\s)-\s/g)
    .flatMap(p => p.split(/[,;/]|\band\b/gi))
    .map(s => s.replace(/^[\s\-–—•·*]+/, '').replace(/[\s.]+$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function loadPrior(): Map<string, { canonical: string; keep: string }> {
  const prior = new Map<string, { canonical: string; keep: string }>();
  if (!existsSync(CSV)) return prior;
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? [];
    const unq = (s = '') => s.replace(/^"|"$/g, '').replace(/""/g, '"').trim();
    const candidate = unq(cells[1]);
    const canonical = unq(cells[4]);
    const keep = unq(cells[5]);
    if (candidate && (canonical || keep)) prior.set(candidate, { canonical, keep });
  }
  return prior;
}

async function main() {
  const prior = loadPrior();
  if (existsSync(CSV)) copyFileSync(CSV, `${CSV}.bak`);

  const cases = await prisma.caseStudy.findMany({
    select: { title: true, tech: true }, orderBy: { title: 'asc' },
  });

  type E = { count: number; cases: Set<string>; cat: Set<string> };
  const clean = new Map<string, E>(), prose = new Map<string, E>();

  for (const c of cases) {
    const items = (c.tech ?? []) as Array<{ title?: string; description?: string }>;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const cat = (item?.title ?? '').trim();
      for (const cand of splitCandidates(item?.description ?? '')) {
        const bucket = cand.split(/\s+/).length > PROSE_WORD_LIMIT ? prose : clean;
        const e = bucket.get(cand) ?? { count: 0, cases: new Set(), cat: new Set() };
        e.count++; e.cases.add(c.title); if (cat) e.cat.add(cat);
        bucket.set(cand, e);
      }
    }
  }

  let carried = 0, fresh = 0;
  const rows = (m: Map<string, E>, kind: string) =>
    [...m.entries()]
      .sort((a, b) => b[1].cases.size - a[1].cases.size || a[0].localeCompare(b[0]))
      .map(([name, e]) => {
        const p = prior.get(name);
        if (p) carried++; else fresh++;
        return [
          kind,
          `"${name.replace(/"/g, '""')}"`,
          e.cases.size,
          `"${[...e.cat].join(' | ')}"`,
          p?.canonical ? `"${p.canonical.replace(/"/g, '""')}"` : '',
          p?.keep ?? '',
        ].join(',');
      });

  const csv = [
    'kind,candidate,cases,seen_under_category,CANONICAL_NAME,KEEP_Y_N',
    ...rows(clean, 'LIKELY_TECH'),
    ...rows(prose, 'LIKELY_PROSE'),
  ].join('\n');

  writeFileSync(CSV, csv, 'utf8');
  console.log(`Cases: ${cases.length} | carried-forward: ${carried} | NEW blank rows: ${fresh}`);
  console.log(`Wrote ${CSV} (backup: ${CSV}.bak)`);
  if (fresh > 0) console.log(`\nNOTE: ${fresh} new candidates need CANONICAL_NAME / KEEP — search the CSV for empty KEEP_Y_N.`);
}

main().finally(() => prisma.$disconnect());
