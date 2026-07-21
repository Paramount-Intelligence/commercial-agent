/**
 * Remap integer-style CaseStudy.id → cuid, cascading to child FKs.
 *
 * FK referential actions (from migration 20260714013441_add_agent_schema):
 *   CaseTech_caseId_fkey  → ON DELETE CASCADE ON UPDATE CASCADE
 *   CaseChunk_caseId_fkey → ON DELETE CASCADE ON UPDATE CASCADE
 *   CaseAsset_caseId_fkey → ON DELETE CASCADE ON UPDATE CASCADE
 *
 * Approach: ONE parameterized UPDATE on CaseStudy.id; Postgres cascades caseId on children.
 * Single $executeRaw round-trip (avoids interactive-txn timeout / P2028).
 *
 *   npm run ids:remap:dry
 *   npm run ids:remap
 */
import cuid from 'cuid';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

const DRY = process.argv.includes('--dry-run');
const CUID_RE = /^c[a-z0-9]{24,}$/;

type ChildCounts = { tech: number; chunk: number; asset: number };

async function countChildren(caseId: string): Promise<ChildCounts> {
  const [tech, chunk, asset] = await Promise.all([
    prisma.caseTech.count({ where: { caseId } }),
    prisma.caseChunk.count({ where: { caseId } }),
    prisma.caseAsset.count({ where: { caseId } }),
  ]);
  return { tech, chunk, asset };
}

async function main() {
  console.log(
    DRY
      ? '=== DRY RUN (no writes) — FK strategy: ON UPDATE CASCADE on parent id ===\n'
      : '=== LIVE REMAP — single UPDATE … FROM (VALUES …); CASCADE rewrites children ===\n',
  );
  console.log(
    'Why cascade: migration declares CaseTech/CaseChunk/CaseAsset FKs as',
  );
  console.log('  ON UPDATE CASCADE — updating CaseStudy.id rewrites child caseId.\n');

  // Prisma can't filter id-by-regex; load all and filter in JS
  const all = await prisma.caseStudy.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });
  const targets = all
    .filter((c) => /^\d+$/.test(c.id))
    .sort((a, b) => Number(a.id) - Number(b.id));

  if (targets.length !== 18) {
    console.log(
      `⚠️  Expected 18 integer-style ids, found ${targets.length}. Proceeding with found set.`,
    );
  }

  type PlanRow = {
    oldId: string;
    newId: string;
    title: string;
    before: ChildCounts;
  };

  const plan: PlanRow[] = [];
  for (const c of targets) {
    let newId = cuid();
    // collision / format guard
    while (!CUID_RE.test(newId) || all.some((x) => x.id === newId) || plan.some((p) => p.newId === newId)) {
      newId = cuid();
    }
    const before = await countChildren(c.id);
    plan.push({ oldId: c.id, newId, title: c.title, before });
  }

  console.log('=== MAPPING (oldId → newId) ===');
  for (const p of plan) {
    console.log(`  ${p.oldId.padStart(4)} → ${p.newId}  ${p.title}`);
  }

  console.log('\n=== CHILD COUNTS BEFORE (per case) ===');
  console.log(
    `  ${'old'.padStart(4)}  ${'#Tech'.padStart(5)}  ${'#Chunk'.padStart(6)}  ${'#Asset'.padStart(6)}  title`,
  );
  let sumTech = 0;
  let sumChunk = 0;
  let sumAsset = 0;
  for (const p of plan) {
    sumTech += p.before.tech;
    sumChunk += p.before.chunk;
    sumAsset += p.before.asset;
    console.log(
      `  ${p.oldId.padStart(4)}  ${String(p.before.tech).padStart(5)}  ${String(p.before.chunk).padStart(6)}  ${String(p.before.asset).padStart(6)}  ${p.title}`,
    );
  }

  const parentN = plan.length;
  const childRows = sumTech + sumChunk + sumAsset;
  // parent updates + cascaded child updates (logical row touch count)
  const wouldUpdate = parentN + childRows;

  console.log('\n=== TOTALS ===');
  console.log(`  parents (integer CaseStudy): ${parentN}`);
  console.log(`  CaseTech:  ${sumTech}`);
  console.log(`  CaseChunk: ${sumChunk}`);
  console.log(`  CaseAsset: ${sumAsset}`);
  console.log(
    `  would update: ${wouldUpdate} rows (${parentN} parent + ${childRows} children via CASCADE)`,
  );

  if (DRY) {
    console.log('\nDRY RUN complete — no writes performed.');
    return;
  }

  // LIVE: one parameterized UPDATE — atomic, single round-trip
  console.log('\n=== APPLYING (single $executeRaw UPDATE … FROM VALUES) ===');
  const valueTuples = plan.map(
    (p) => Prisma.sql`(${p.oldId}, ${p.newId})`,
  );
  const rowsAffected = await prisma.$executeRaw`
    UPDATE "CaseStudy" AS c
    SET id = v.new_id
    FROM (VALUES ${Prisma.join(valueTuples)}) AS v(old_id, new_id)
    WHERE c.id = v.old_id
  `;
  console.log(`  rows-affected (parents): ${rowsAffected} (expect ${plan.length})`);
  if (rowsAffected !== plan.length) {
    console.error(
      `  ⚠️  expected ${plan.length} parent rows updated, got ${rowsAffected}`,
    );
  }

  // Re-verify
  console.log('\n=== POST-VERIFY ===');
  let allOk = true;

  for (const p of plan) {
    const after = await countChildren(p.newId);
    const match =
      after.tech === p.before.tech &&
      after.chunk === p.before.chunk &&
      after.asset === p.before.asset;
    if (match) {
      console.log(
        `PASS  children preserved ${p.oldId}→${p.newId} (tech=${after.tech} chunk=${after.chunk} asset=${after.asset})`,
      );
    } else {
      allOk = false;
      console.log(
        `FAIL  children mismatch ${p.oldId}→${p.newId}: before=${JSON.stringify(p.before)} after=${JSON.stringify(after)}`,
      );
    }
  }

  const remainingInt = await prisma.caseStudy.findMany({
    select: { id: true },
  });
  const stillInt = remainingInt.filter((c) => /^\d+$/.test(c.id));
  if (stillInt.length === 0) {
    console.log('PASS  zero CaseStudy rows with integer ids');
  } else {
    allOk = false;
    console.log(
      `FAIL  ${stillInt.length} integer CaseStudy ids remain: ${stillInt.map((c) => c.id).join(', ')}`,
    );
  }

  const [caseN, chunkN, techN] = await Promise.all([
    prisma.caseStudy.count(),
    prisma.caseChunk.count(),
    prisma.caseTech.count(),
  ]);
  if (caseN === 45) {
    console.log('PASS  CaseStudy total = 45');
  } else {
    allOk = false;
    console.log(`FAIL  CaseStudy total expected 45, got ${caseN}`);
  }
  if (chunkN === 180) {
    console.log('PASS  CaseChunk total = 180');
  } else {
    allOk = false;
    console.log(`FAIL  CaseChunk total expected 180, got ${chunkN}`);
  }
  if (techN === 192) {
    console.log('PASS  CaseTech total = 192');
  } else {
    allOk = false;
    console.log(`FAIL  CaseTech total expected 192, got ${techN}`);
  }

  // Orphans: child caseId not in CaseStudy
  const [techOrphans, chunkOrphans] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "CaseTech" t
      WHERE NOT EXISTS (SELECT 1 FROM "CaseStudy" s WHERE s.id = t."caseId")
    `,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "CaseChunk" c
      WHERE NOT EXISTS (SELECT 1 FROM "CaseStudy" s WHERE s.id = c."caseId")
    `,
  ]);

  const orphanTech = Number(techOrphans[0]?.n ?? 0);
  const orphanChunk = Number(chunkOrphans[0]?.n ?? 0);

  if (orphanTech + orphanChunk === 0) {
    console.log('PASS  zero orphaned CaseTech/CaseChunk rows');
  } else {
    allOk = false;
    console.log(
      `FAIL  orphans — CaseTech=${orphanTech} CaseChunk=${orphanChunk}`,
    );
  }

  console.log('\n' + '='.repeat(40));
  console.log(allOk ? 'ALL ASSERTIONS PASSED' : 'SOME ASSERTIONS FAILED');
  if (!allOk) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
