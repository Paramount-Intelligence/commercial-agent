/**
 * Chunk CaseStudy rows by section and write CaseChunk embeddings (pgvector).
 *
 * Idempotent: deletes existing chunks for each caseId before reinserting.
 * Embedding column is Unsupported("vector(1536)") — written via $executeRaw + CAST AS vector.
 *
 *   npm run embed:cases:dry
 *   npm run embed:cases
 *   npx tsx --env-file=.env.local scripts/chunk-and-embed.ts --dry-run
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { embed } from '../lib/retrieval/embed';

const DRY = process.argv.includes('--dry-run');

/** Sections → CaseStudy text fields. One chunk per non-empty section. */
const SECTIONS = [
  { heading: 'overview', field: 'overview' },
  { heading: 'challenge', field: 'challenge' },
  { heading: 'solution', field: 'solution' },
  { heading: 'results', field: 'results' },
] as const;

type SectionHeading = (typeof SECTIONS)[number]['heading'];

/** Nullability matches schema.prisma CaseStudy exactly. */
type CaseRow = {
  id: string;
  title: string;
  overview: string | null;   // String?
  challenge: string | null;  // String?
  solution: string;          // String (required)
  results: string | null;    // String?
};

type Tx = Prisma.TransactionClient;

function sectionText(c: CaseRow, field: (typeof SECTIONS)[number]['field']): string {
  const raw = c[field];
  if (typeof raw !== 'string') return '';
  const content = raw.trim();
  // Treat seed/placeholder stubs as empty
  if (!content || /^(n\/a|na|-)$/i.test(content)) return '';
  return content;
}

/** Whole-section chunks only — never split mid-sentence. */
function chunksForCase(c: CaseRow): Array<{ heading: SectionHeading; content: string }> {
  const out: Array<{ heading: SectionHeading; content: string }> = [];
  for (const s of SECTIONS) {
    const content = sectionText(c, s.field);
    if (!content) continue;
    out.push({ heading: s.heading, content });
  }
  return out;
}

/** Parameterized vector write — value is a bind param, then cast. */
async function insertChunk(
  tx: Tx,
  caseId: string,
  heading: string,
  content: string,
  embedding: number[],
) {
  const id = randomUUID();
  const vectorStr = `[${embedding.join(',')}]`;

  // Bind vectorStr as a param, then cast — never interpolate into SQL text.
  await tx.$executeRaw`
    INSERT INTO "CaseChunk" (id, "caseId", heading, content, embedding)
    VALUES (${id}, ${caseId}, ${heading}, ${content}, CAST(${vectorStr} AS vector))
  `;
}

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
    const parts = chunksForCase(c);
    if (parts.length === 0) {
      zeroChunkCases.push(c.title);
      console.log(`  – ${c.title}: no non-empty sections, skipping`);
      if (!DRY) {
        // Still clear stale chunks so re-runs stay clean
        await prisma.caseChunk.deleteMany({ where: { caseId: c.id } });
      }
      casesProcessed++;
      perCase.push(0);
      continue;
    }

    const sectionList = parts.map((p) => p.heading).join(', ');

    if (DRY) {
      console.log(`  ○ ${c.title}: would write ${parts.length} chunk(s) [${sectionList}]`);
      casesProcessed++;
      chunksWritten += parts.length;
      perCase.push(parts.length);
      continue;
    }

    // Prefix heading so the vector carries section context
    const texts = parts.map((p) => `${p.heading}\n\n${p.content}`);
    const vectors = await embed(texts);

    if (vectors.length !== parts.length) {
      throw new Error(
        `embed length mismatch for ${c.title}: ${vectors.length} vs ${parts.length}`,
      );
    }

    // All-or-nothing per case: delete + inserts in one transaction
    await prisma.$transaction(async (tx) => {
      await tx.caseChunk.deleteMany({ where: { caseId: c.id } });
      for (let i = 0; i < parts.length; i++) {
        await insertChunk(tx, c.id, parts[i].heading, parts[i].content, vectors[i]);
      }
    });

    casesProcessed++;
    chunksWritten += parts.length;
    perCase.push(parts.length);
    console.log(`  ✓ ${c.title}: ${parts.length} chunk(s) [${sectionList}]`);
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
