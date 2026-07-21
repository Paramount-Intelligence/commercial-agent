/**
 * STEP 2 — Populate TechAlias + CaseTech from Ali's canonicalized CSV.
 *
 * IDEMPOTENT. Re-run this after every content enrichment pass:
 *   - re-runs the extraction logic over the current tech JSON
 *   - maps each candidate through TechAlias
 *   - syncs CaseTech to match (adds new, removes stale)
 *
 * Nothing is destructive outside CaseTech, which is a derived table.
 * CaseStudy.tech is never touched — it stays the source of truth for the website.
 *
 *   npx tsx scripts/backfill-casetech.ts            # dry run, prints the plan
 *   npx tsx scripts/backfill-casetech.ts --apply    # writes
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const PROSE_WORD_LIMIT = 4;

function splitCandidates(desc: string): string[] {
  return desc
    .split(/[\n\r]+|[•·]|(?:^|\s)-\s/g)
    .flatMap(part => part.split(/[,;/]|\band\b/gi))
    .map(s => s.replace(/^[\s\-–—•·*]+/, '').replace(/[\s.]+$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Parse Ali's CSV -> alias(lowercased) -> canonical. Rows marked KEEP != y are dropped. */
function loadAliasCsv(path: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).slice(1);

  for (const line of lines) {
    if (!line.trim()) continue;
    // naive CSV split that respects quoted fields
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? [];
    const unq = (s = '') => s.replace(/^"|"$/g, '').replace(/""/g, '"').trim();

    const candidate = unq(cells[1]);
    const canonical = unq(cells[4]);
    const keep = unq(cells[5]).toLowerCase();

    if (!candidate || keep !== 'y' || !canonical) continue;
    map.set(candidate.toLowerCase(), canonical);
  }
  return map;
}

async function main() {
  const alias = loadAliasCsv('tech-candidates.csv');
  console.log(`Alias map: ${alias.size} entries\n`);
  if (alias.size === 0) {
    console.log('No rows marked KEEP=y with a CANONICAL_NAME. Nothing to do.');
    return;
  }

  // 1. Sync TechAlias table (so the mapping is auditable in the DB)
  if (APPLY) {
    for (const [a, canonical] of alias) {
      await prisma.techAlias.upsert({
        where: { alias: a },
        update: { canonical },
        create: { alias: a, canonical },
      });
    }
    console.log(`✓ TechAlias synced (${alias.size} rows)\n`);
  }

  // 2. Recompute CaseTech for every case
  const cases = await prisma.caseStudy.findMany({
    select: { id: true, title: true, tech: true, techTags: { select: { name: true } } },
    orderBy: { title: 'asc' },
  });

  let added = 0, removed = 0, unchanged = 0;

  for (const c of cases) {
    const items = (c.tech ?? []) as Array<{ description?: string }>;
    const want = new Set<string>();

    if (Array.isArray(items)) {
      for (const item of items) {
        for (const cand of splitCandidates(item?.description ?? '')) {
          const canonical = alias.get(cand.toLowerCase());
          if (canonical) want.add(canonical);
        }
      }
    }

    const have = new Set(c.techTags.map(t => t.name));
    const toAdd = [...want].filter(n => !have.has(n));
    const toRemove = [...have].filter(n => !want.has(n));

    if (toAdd.length === 0 && toRemove.length === 0) {
      unchanged++;
      continue;
    }

    console.log(`${c.title}`);
    if (toAdd.length)    console.log(`   + ${toAdd.join(', ')}`);
    if (toRemove.length) console.log(`   - ${toRemove.join(', ')}`);

    if (APPLY) {
      if (toRemove.length) {
        await prisma.caseTech.deleteMany({
          where: { caseId: c.id, name: { in: toRemove } },
        });
      }
      if (toAdd.length) {
        await prisma.caseTech.createMany({
          data: toAdd.map(name => ({ caseId: c.id, name })),
          skipDuplicates: true,
        });
      }
    }
    added += toAdd.length;
    removed += toRemove.length;
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — +${added} tags, -${removed} tags, ${unchanged} cases unchanged`);
  if (!APPLY) console.log('Re-run with --apply to write.');
}

main().finally(() => prisma.$disconnect());