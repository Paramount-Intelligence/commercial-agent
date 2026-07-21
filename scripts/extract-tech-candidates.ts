/**
 * STEP 1 — Extract candidate technology names from CaseStudy.tech JSON.
 *
 * Reads the tech JSON prose, splits it into candidate strings, and writes a CSV
 * for Ali to canonicalize. It does NOT write to the database.
 *
 * Safe to re-run any time the corpus is enriched.
 *
 *   npx tsx scripts/extract-tech-candidates.ts
 *   -> writes tech-candidates.csv
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';

const prisma = new PrismaClient();

/** Anything longer than this many words is almost certainly prose, not a tech name. */
const PROSE_WORD_LIMIT = 4;

/** Split a description into candidate technology names. */
function splitCandidates(desc: string): string[] {
  return desc
    // bullets and newlines are hard separators
    .split(/[\n\r]+|[•·]|(?:^|\s)-\s/g)
    // commas, semicolons, slashes and " and " are soft separators
    .flatMap(part => part.split(/[,;/]|\band\b/gi))
    .map(s =>
      s
        .replace(/^[\s\-–—•·*]+/, '')   // leading bullet junk
        .replace(/[\s.]+$/, '')          // trailing punctuation
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: { id: true, title: true, tech: true },
    orderBy: { title: 'asc' },
  });

  type Entry = { count: number; cases: Set<string>; category: Set<string> };
  const clean = new Map<string, Entry>();
  const prose = new Map<string, Entry>();

  for (const c of cases) {
    const items = (c.tech ?? []) as Array<{ title?: string; description?: string }>;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const category = (item?.title ?? '').trim();
      const desc = (item?.description ?? '').trim();
      if (!desc) continue;

      for (const cand of splitCandidates(desc)) {
        const words = cand.split(/\s+/).length;
        const bucket = words > PROSE_WORD_LIMIT ? prose : clean;

        const e = bucket.get(cand) ?? { count: 0, cases: new Set(), category: new Set() };
        e.count += 1;
        e.cases.add(c.title);
        if (category) e.category.add(category);
        bucket.set(cand, e);
      }
    }
  }

  const rows = (m: Map<string, Entry>, kind: string) =>
    [...m.entries()]
      .sort((a, b) => b[1].cases.size - a[1].cases.size || a[0].localeCompare(b[0]))
      .map(([name, e]) => [
        kind,
        `"${name.replace(/"/g, '""')}"`,
        e.cases.size,
        `"${[...e.category].join(' | ')}"`,
        '',   // canonical  <- Ali fills this
        '',   // keep (y/n) <- Ali fills this
      ].join(','));

  const csv = [
    'kind,candidate,cases,seen_under_category,CANONICAL_NAME,KEEP_Y_N',
    ...rows(clean, 'LIKELY_TECH'),
    ...rows(prose, 'LIKELY_PROSE'),
  ].join('\n');

  writeFileSync('tech-candidates.csv', csv, 'utf8');

  console.log(`Cases scanned:        ${cases.length}`);
  console.log(`Likely tech names:    ${clean.size}`);
  console.log(`Likely prose (review):${prose.size}`);
  console.log(`\nWrote tech-candidates.csv — hand this to Ali.\n`);
  console.log('=== TOP LIKELY TECH (by case coverage) ===');
  [...clean.entries()]
    .sort((a, b) => b[1].cases.size - a[1].cases.size)
    .slice(0, 40)
    .forEach(([n, e]) => console.log(`  ${String(e.cases.size).padStart(3)} cases  ${n}`));
}

main().finally(() => prisma.$disconnect());