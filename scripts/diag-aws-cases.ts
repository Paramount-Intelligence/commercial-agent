/**
 * READ ONLY — diagnose why AgentCore cases may miss AWS techMatch.
 *
 *   npx tsx --env-file=.env.local scripts/diag-aws-cases.ts
 */
import { prisma } from '../lib/db';
import { searchCases } from '../lib/retrieval/searchCases';

const TARGET_TITLES = [
  'AI Agent Governance & Discovery Platform on AWS AgentCore',
  'Multi Agent Shopping Intelligence on AWS Bedrock AgentCore',
] as const;

async function main() {
  console.log('=== 1–2. Target cases: CaseTech names + exact AWS? ===\n');

  for (const title of TARGET_TITLES) {
    const c = await prisma.caseStudy.findFirst({
      where: { title },
      select: {
        id: true,
        title: true,
        techTags: { select: { name: true }, orderBy: { name: 'asc' } },
      },
    });

    if (!c) {
      console.log(`NOT FOUND: ${title}\n`);
      continue;
    }

    const names = c.techTags.map((t) => t.name);
    const hasExactAws = names.includes('AWS');
    console.log(`Title: ${c.title}`);
    console.log(`Id:    ${c.id}`);
    console.log(`CaseTech (${names.length}):`);
    for (const n of names) {
      console.log(`  - ${JSON.stringify(n)}`);
    }
    console.log(`Exact CaseTech.name === 'AWS': ${hasExactAws ? 'YES' : 'NO'}`);
    console.log('');
  }

  console.log("=== 3. TechAlias rows where canonical = 'AWS' ===\n");
  const aliases = await prisma.techAlias.findMany({
    where: { canonical: 'AWS' },
    orderBy: { alias: 'asc' },
  });
  if (aliases.length === 0) {
    console.log('  (none)');
  } else {
    for (const a of aliases) {
      console.log(`  alias=${JSON.stringify(a.alias)} → canonical=${JSON.stringify(a.canonical)}`);
    }
  }

  console.log('\n=== 4. searchCases({ techs: ["AWS"], limit: 45 }) ===\n');
  const ranked = await searchCases({ techs: ['AWS'], limit: 45 });
  console.log(`Returned ${ranked.length} result(s)\n`);
  console.log(
    `  ${'#'.padStart(3)}  ${'score'.padStart(5)}  ${'tech'.padStart(4)}  ${'pe'.padStart(4)}  ${'sim'.padStart(5)}  title`,
  );
  for (let i = 0; i < ranked.length; i++) {
    const h = ranked[i];
    console.log(
      `  ${String(i + 1).padStart(3)}  ${h.score.toFixed(2).padStart(5)}  ${h.techScore.toFixed(1).padStart(4)}  ${h.peScore.toFixed(1).padStart(4)}  ${h.simScore.toFixed(3).padStart(5)}  ${h.title}  (${h.matchedTechs.join('+') || '—'})`,
    );
  }

  console.log('\n--- Target cases in ranked list? ---');
  for (const title of TARGET_TITLES) {
    const idx = ranked.findIndex((r) => r.title === title);
    if (idx === -1) {
      console.log(`  ABSENT (not matched at any rank): ${title}`);
    } else {
      const h = ranked[idx];
      console.log(
        `  rank ${idx + 1}/${ranked.length} score=${h.score.toFixed(2)} techScore=${h.techScore} matched=[${h.matchedTechs.join(', ')}]: ${title}`,
      );
    }
  }

  console.log(
    "\n=== AWS-family CaseTech.name (contains AWS|Amazon|Bedrock|Lambda) ===\n",
  );
  const allTags = await prisma.caseTech.findMany({
    select: { name: true, caseId: true },
  });
  const re = /AWS|Amazon|Bedrock|Lambda/i;
  const byName = new Map<string, Set<string>>();
  for (const t of allTags) {
    if (!re.test(t.name)) continue;
    if (!byName.has(t.name)) byName.set(t.name, new Set());
    byName.get(t.name)!.add(t.caseId);
  }
  const sorted = [...byName.entries()].sort(
    (a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]),
  );
  console.log(`  ${'cases'.padStart(5)}  name`);
  for (const [name, cases] of sorted) {
    const rollsUp = name === 'AWS' ? ' ← exact AWS' : '';
    console.log(`  ${String(cases.size).padStart(5)}  ${JSON.stringify(name)}${rollsUp}`);
  }
  console.log(`\n  Distinct AWS-family tags: ${sorted.length}`);
  console.log(
    `  Tags that are NOT exact 'AWS': ${sorted.filter(([n]) => n !== 'AWS').length}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // searchCases may use shared prisma; disconnect once
    await prisma.$disconnect();
  });
