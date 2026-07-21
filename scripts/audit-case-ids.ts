/**
 * READ-ONLY audit of CaseStudy.id shapes (cuid vs integer-style legacy).
 * No writes, no schema changes.
 *
 *   npm run ids:audit
 *   npx tsx --env-file=.env.local scripts/audit-case-ids.ts
 */
import { prisma } from '../lib/db';

type IdClass = 'integer-style' | 'cuid' | 'other';

function classifyId(id: string): IdClass {
  if (/^\d+$/.test(id)) return 'integer-style';
  if (/^c[a-z0-9]{24,}$/.test(id)) return 'cuid';
  return 'other';
}

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });

  const buckets: Record<IdClass, typeof cases> = {
    'integer-style': [],
    cuid: [],
    other: [],
  };

  for (const c of cases) {
    buckets[classifyId(c.id)].push(c);
  }

  console.log('=== CaseStudy.id CLASSIFICATION ===\n');
  console.log(`Total cases: ${cases.length}`);
  console.log(`  integer-style: ${buckets['integer-style'].length}`);
  console.log(`  cuid:          ${buckets.cuid.length}`);
  console.log(`  other:         ${buckets.other.length}`);

  console.log('\n=== INTEGER-STYLE IDs (guessable) ===');
  if (buckets['integer-style'].length === 0) {
    console.log('  (none)');
  } else {
    for (const c of buckets['integer-style'].sort(
      (a, b) => Number(a.id) - Number(b.id),
    )) {
      console.log(`  ${c.id.padStart(4)}  ${c.title}`);
    }
  }

  // 2. Collision / entropy
  console.log('\n=== INTEGER ID SPACE (entropy / guessability) ===');
  if (buckets['integer-style'].length === 0) {
    console.log('  N/A — no integer-style IDs');
  } else {
    const nums = buckets['integer-style']
      .map((c) => Number(c.id))
      .sort((a, b) => a - b);
    const min = nums[0];
    const max = nums[nums.length - 1];
    const unique = new Set(nums);
    const span = max - min + 1;
    const contiguous = unique.size === span && nums.length === span;

    console.log(`  count:       ${nums.length}`);
    console.log(`  min:         ${min}`);
    console.log(`  max:         ${max}`);
    console.log(`  span (max-min+1): ${span}`);
    console.log(`  contiguous 1..N style: ${contiguous ? 'YES' : 'NO'}`);
    console.log(
      `  density in span: ${(nums.length / span).toFixed(2)} (${nums.length}/${span})`,
    );

    if (contiguous || (min <= 5 && max <= 50 && nums.length / span >= 0.5)) {
      console.log(
        '  VERDICT: low-entropy integer range — a model guessing small integers',
      );
      console.log(
        '  (e.g. "12", "14") has a real chance of hitting a live CaseStudy.id.',
      );
    } else {
      console.log(
        '  VERDICT: integers present but not a dense low range; still guessable vs cuid.',
      );
    }
  }

  // 3. FK blast radius for integer-style only
  console.log('\n=== FK BLAST RADIUS (integer-style cases only) ===');
  console.log(
    '  (rows that would need rewriting if these ids were migrated to cuid)\n',
  );

  let totalTech = 0;
  let totalChunk = 0;
  let totalAsset = 0;

  const intCases = [...buckets['integer-style']].sort(
    (a, b) => Number(a.id) - Number(b.id),
  );

  if (intCases.length === 0) {
    console.log('  (none)');
  } else {
    console.log(
      `  ${'id'.padStart(4)}  ${'#Tech'.padStart(5)}  ${'#Chunk'.padStart(6)}  ${'#Asset'.padStart(6)}  title`,
    );
    for (const c of intCases) {
      const [techN, chunkN, assetN] = await Promise.all([
        prisma.caseTech.count({ where: { caseId: c.id } }),
        prisma.caseChunk.count({ where: { caseId: c.id } }),
        prisma.caseAsset.count({ where: { caseId: c.id } }),
      ]);
      totalTech += techN;
      totalChunk += chunkN;
      totalAsset += assetN;
      console.log(
        `  ${c.id.padStart(4)}  ${String(techN).padStart(5)}  ${String(chunkN).padStart(6)}  ${String(assetN).padStart(6)}  ${c.title}`,
      );
    }
  }

  // 4. Summary verdict
  console.log('\n=== SUMMARY VERDICT ===');
  console.log(
    `  ${buckets['integer-style'].length} of ${cases.length} cases have guessable integer IDs`,
  );
  console.log(
    `  Migrating them to cuid would touch ${totalTech} CaseTech + ${totalChunk} CaseChunk + ${totalAsset} CaseAsset rows`,
  );
  if (buckets.other.length === 0) {
    console.log('  No unexpected "other"-class IDs.');
  } else {
    console.log(`  ⚠️  ${buckets.other.length} unexpected "other"-class ID(s):`);
    for (const c of buckets.other) {
      console.log(`      ${c.id}  ${c.title}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
