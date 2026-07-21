/**
 * READ-ONLY check after remap attempt — detect clean rollback vs partial commit.
 *
 *   npx tsx --env-file=.env.local scripts/check-remap-state.ts
 */
import { prisma } from '../lib/db';

/** New cuids from the failed live remap run (terminal log). */
const LIVE_RUN_NEW_IDS = [
  'cmrnlms0n00001od5e2oucqca',
  'cmrnlmu7t00011od55rkmgztd',
  'cmrnlmuqo00021od55kjlcxez',
  'cmrnlmv9000031od5flkx30g8',
  'cmrnlmvrw00041od505elgdzn',
  'cmrnlmw1b00051od564qufmo6',
  'cmrnlmwle00061od5ar8hhmum',
  'cmrnlmwwg00071od506w92mwh',
  'cmrnlmx7p00081od58x001zwu',
  'cmrnlmxh100091od5h7svewl0',
  'cmrnlmxqf000a1od5h3qh75eu',
  'cmrnlmxzv000b1od5735sd61j',
  'cmrnlmy9c000c1od56u5h4q65',
  'cmrnlmyis000d1od5gi5qeutp',
  'cmrnlmys8000e1od5gavl21x6',
  'cmrnlmz1o000f1od58mx98nty',
  'cmrnlmzb6000g1od5el0v7ci0',
  'cmrnlmzkj000h1od54u1uaw6z',
] as const;

function line(
  label: string,
  expected: string | number,
  actual: string | number,
  ok: boolean,
) {
  console.log(
    `  [${ok ? 'OK' : '!!'}] ${label}: expected ${expected}, actual ${actual}`,
  );
}

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: { id: true, title: true },
  });

  const integerIds = cases.filter((c) => /^\d+$/.test(c.id));
  const newMapped = cases.filter((c) =>
    (LIVE_RUN_NEW_IDS as readonly string[]).includes(c.id),
  );

  const [caseN, chunkN, techN] = await Promise.all([
    prisma.caseStudy.count(),
    prisma.caseChunk.count(),
    prisma.caseTech.count(),
  ]);

  const [chunkOrphans, techOrphans] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "CaseChunk" c
      WHERE NOT EXISTS (SELECT 1 FROM "CaseStudy" s WHERE s.id = c."caseId")
    `,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "CaseTech" t
      WHERE NOT EXISTS (SELECT 1 FROM "CaseStudy" s WHERE s.id = t."caseId")
    `,
  ]);
  const orphanChunk = Number(chunkOrphans[0]?.n ?? 0);
  const orphanTech = Number(techOrphans[0]?.n ?? 0);

  console.log('=== REMAP STATE CHECK (read-only) ===\n');

  console.log('1. Integer-style CaseStudy.id');
  line('integer id count', 18, integerIds.length, integerIds.length === 18);
  if (integerIds.length > 0 && integerIds.length !== 18) {
    console.log(
      `     remaining integers: ${integerIds
        .map((c) => c.id)
        .sort((a, b) => Number(a) - Number(b))
        .join(', ')}`,
    );
  }

  console.log('\n2. Live-run NEW cuids present in CaseStudy');
  line('new-mapping cuid count', 0, newMapped.length, newMapped.length === 0);
  if (newMapped.length > 0) {
    for (const c of newMapped) {
      console.log(`     ${c.id}  ${c.title}`);
    }
  } else {
    console.log('     (none — good for rollback)');
  }

  console.log('\n3. Global invariants');
  line('CaseStudy total', 45, caseN, caseN === 45);
  line('CaseChunk total', 180, chunkN, chunkN === 180);
  line('CaseTech total', 192, techN, techN === 192);

  console.log('\n4. Orphan check');
  line('orphaned CaseChunk', 0, orphanChunk, orphanChunk === 0);
  line('orphaned CaseTech', 0, orphanTech, orphanTech === 0);

  const cleanRollback =
    integerIds.length === 18 &&
    newMapped.length === 0 &&
    caseN === 45 &&
    chunkN === 180 &&
    techN === 192 &&
    orphanChunk === 0 &&
    orphanTech === 0;

  const partialCommit =
    !cleanRollback &&
    (integerIds.length < 18 ||
      newMapped.length > 0 ||
      orphanChunk > 0 ||
      orphanTech > 0);

  console.log('\n=== VERDICT ===');
  if (cleanRollback) {
    console.log('CLEAN ROLLBACK');
  } else if (partialCommit) {
    console.log('PARTIAL COMMIT');
  } else {
    console.log('OTHER');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
