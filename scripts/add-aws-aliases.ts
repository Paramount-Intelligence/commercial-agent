/**
 * Propose / apply AWS-family TechAlias rollup (service tags → canonical AWS).
 *
 * NOTE: TechAlias alone only remaps query INPUT. For CaseTech "AWS Bedrock" to
 * match techs:['AWS'], searchCases must also treat a tag as matching if
 * TechAlias[tag.lower] === 'AWS' (reverse alias). Dry projections use that rule.
 * Live step upserts aliases; confirm step runs searchCases — wire reverse match
 * in searchCases before expecting AgentCore to score.
 *
 *   npm run aws:aliases:dry
 *   npm run aws:aliases
 */
import { prisma } from '../lib/db';
import { searchCases } from '../lib/retrieval/searchCases';

const DRY = process.argv.includes('--dry-run');
const CANONICAL = 'AWS';

async function main() {
  const tags = await prisma.caseTech.findMany({
    select: { name: true, caseId: true },
  });

  // 1. Distinct CaseTech.name containing AWS or Amazon
  const family = new Map<string, Set<string>>(); // name → caseIds
  for (const t of tags) {
    if (!/AWS|Amazon/i.test(t.name)) continue;
    if (!family.has(t.name)) family.set(t.name, new Set());
    family.get(t.name)!.add(t.caseId);
  }

  // 2. Propose aliases (exclude bare AWS)
  const proposed = [...family.entries()]
    .filter(([name]) => name !== CANONICAL)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([name, caseIds]) => ({
      alias: name.toLowerCase(),
      displayName: name,
      caseCount: caseIds.size,
      caseIds,
    }));

  console.log(`=== PROPOSED TechAlias → canonical '${CANONICAL}' ===\n`);
  for (const p of proposed) {
    console.log(
      `  alias=${JSON.stringify(p.alias)} → canonical=${JSON.stringify(CANONICAL)}  (#cases=${p.caseCount})  [${p.displayName}]`,
    );
  }
  console.log(`\n  Proposed: ${proposed.length} aliases (bare '${CANONICAL}' excluded)\n`);

  // 3. Existing TechAlias
  const existing = await prisma.techAlias.findMany({
    where: { alias: { in: proposed.map((p) => p.alias) } },
  });
  const existingMap = new Map(existing.map((e) => [e.alias, e.canonical]));

  const neu = proposed.filter((p) => !existingMap.has(p.alias));
  const already = proposed.filter((p) => existingMap.has(p.alias));
  const conflict = already.filter((p) => existingMap.get(p.alias) !== CANONICAL);

  console.log('=== vs existing TechAlias ===');
  console.log(`  new:              ${neu.length}`);
  console.log(`  already present:  ${already.length}`);
  if (conflict.length > 0) {
    console.log(`  ⚠️  conflicts (alias exists with different canonical):`);
    for (const p of conflict) {
      console.log(`     ${p.alias} → ${existingMap.get(p.alias)} (wanted ${CANONICAL})`);
    }
  }
  for (const p of already) {
    console.log(
      `  existing  alias=${JSON.stringify(p.alias)} canonical=${JSON.stringify(existingMap.get(p.alias))}`,
    );
  }

  // 4. Projected AWS match lift (reverse-alias simulation)
  const casesWithBareAws = new Set(
    tags.filter((t) => t.name === CANONICAL).map((t) => t.caseId),
  );
  const newlyMatched = new Set<string>();
  console.log('\n=== NEW matches if reverse-alias matching were live ===');
  for (const p of proposed) {
    let n = 0;
    for (const id of p.caseIds) {
      if (!casesWithBareAws.has(id)) {
        newlyMatched.add(id);
        n++;
      }
    }
    console.log(
      `  ${JSON.stringify(p.alias)}: ${n} case(s) have this tag but not bare AWS`,
    );
  }

  const projectedAwsCases = new Set([...casesWithBareAws, ...newlyMatched]);
  console.log(`\n  Current bare-AWS CaseTech cases: ${casesWithBareAws.size}`);
  console.log(`  Newly covered via service tags:  ${newlyMatched.size}`);
  console.log(
    `  Projected AWS-query match count (techScore>=1): ${projectedAwsCases.size} (was ${casesWithBareAws.size})`,
  );

  if (DRY) {
    console.log('\nDRY RUN — no writes. Review the list; exclude any non-AWS before live.');
    return;
  }

  // 5. LIVE upsert
  console.log('\n=== UPSERTING TechAlias ===');
  let upserted = 0;
  for (const p of proposed) {
    if (conflict.some((c) => c.alias === p.alias)) {
      console.log(`  SKIP conflict ${p.alias}`);
      continue;
    }
    await prisma.techAlias.upsert({
      where: { alias: p.alias },
      update: { canonical: CANONICAL },
      create: { alias: p.alias, canonical: CANONICAL },
    });
    upserted++;
    console.log(`  ✓ ${p.alias} → ${CANONICAL}`);
  }
  console.log(`Upserted: ${upserted}`);

  console.log('\n=== searchCases({ techs: ["AWS"], limit: 45 }) ===');
  const ranked = await searchCases({ techs: ['AWS'], limit: 45 });
  const matched = ranked.filter((r) => r.techScore >= 1);
  console.log(`techScore>=1: ${matched.length}`);

  const targets = [
    'AI Agent Governance & Discovery Platform on AWS AgentCore',
    'Multi Agent Shopping Intelligence on AWS Bedrock AgentCore',
  ];
  for (const title of targets) {
    const hit = ranked.find((r) => r.title === title);
    if (!hit) {
      console.log(`  ABSENT: ${title}`);
    } else {
      console.log(
        `  rank=${ranked.indexOf(hit) + 1} techScore=${hit.techScore} score=${hit.score.toFixed(2)}: ${title}`,
      );
      console.log(
        hit.techScore >= 1
          ? `  PASS AgentCore now matches AWS`
          : `  FAIL still techScore=0 — need reverse-alias match in searchCases`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
