/**
 * Chunk CaseStudy rows by section and write CaseChunk embeddings (pgvector).
 *
 * Idempotent: deletes existing chunks for each caseId before reinserting.
 *
 *   npm run embed:cases:dry
 *   npm run embed:cases
 *   npx tsx --env-file=.env.local scripts/chunk-and-embed.ts --dry-run
 */
import { prisma } from '../lib/db';
import { replaceCaseChunks } from '../lib/retrieval/embedCaseChunks';

const DRY = process.argv.includes('--dry-run');

async function main() {
  if (DRY) console.log('=== DRY RUN (no deletes, embeds, or inserts) ===\n');

  const cases = await prisma.caseStudy.findMany({
    select: {
      id: true,
      title: true,
      overview: true,
      challenge: true,
      solution: true,
      results: true,
    },
    orderBy: { title: 'asc' },
  });

  console.log(`Loaded ${cases.length} case(s)\n`);

  let casesProcessed = 0;
  let chunksWritten = 0;
  const perCase: number[] = [];
  const zeroChunkCases: string[] = [];

  for (const c of cases) {
    if (DRY) {
      const sections = (
        [
          ['overview', c.overview],
          ['challenge', c.challenge],
          ['solution', c.solution],
          ['results', c.results],
        ] as const
      ).filter(([, v]) => {
        const t = (v ?? '').trim();
        return t && !/^(n\/a|na|-)$/i.test(t);
      });
      const n = sections.length;
      if (n === 0) {
        zeroChunkCases.push(c.title);
        console.log(`  – ${c.title}: no non-empty sections, skipping`);
      } else {
        console.log(
          `  ○ ${c.title}: would write ${n} chunk(s) [${sections.map((s) => s[0]).join(', ')}]`,
        );
      }
      casesProcessed++;
      chunksWritten += n;
      perCase.push(n);
      continue;
    }

    const result = await replaceCaseChunks(c.id);
    if (result.chunkCount === 0) {
      zeroChunkCases.push(c.title);
      console.log(`  – ${c.title}: no non-empty sections, cleared stale chunks`);
    } else {
      console.log(
        `  ✓ ${c.title}: ${result.chunkCount} chunk(s) [${result.sections.join(', ')}]`,
      );
    }
    casesProcessed++;
    chunksWritten += result.chunkCount;
    perCase.push(result.chunkCount);
  }

  const avg =
    casesProcessed > 0
      ? (chunksWritten / casesProcessed).toFixed(2)
      : '0';

  console.log(`\n=== ${DRY ? 'DRY RUN DONE' : 'DONE'} ===`);
  console.log(`cases processed: ${casesProcessed}`);
  console.log(`chunks ${DRY ? 'would write' : 'written'}:  ${chunksWritten}`);
  console.log(`chunks/case:     ${avg}`);
  console.log(`cases with 0 chunks: ${zeroChunkCases.length}`);
  if (zeroChunkCases.length === 0) {
    console.log(`  (none)`);
  } else {
    zeroChunkCases.forEach((t) => console.log(`  – ${t}`));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
