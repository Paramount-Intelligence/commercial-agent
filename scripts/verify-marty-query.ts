/**
 * VERIFY — exercises searchCases() against every Marty boolean shape + semantic.
 * Score components printed so you can eyeball the 0.4 sim weight.
 *
 *   npx tsx --env-file=.env.local scripts/verify-marty-query.ts
 *
 * (env-file needed for the pure-semantic query → embed())
 */
import { searchCases, type RankedCase, type SearchCasesInput } from '../lib/retrieval/searchCases';
import { prisma } from '../lib/db';

function peTag(pe: boolean | null): string {
  return pe === true ? ' [PE]' : pe === false ? '' : ' [PE?]';
}

function printHits(label: string, hits: RankedCase[]) {
  console.log(`\n${label}  →  ${hits.length} result(s)`);
  console.log(
    `   ${'score'.padStart(5)}  ${'tech'.padStart(4)}  ${'pe'.padStart(4)}  ${'sim'.padStart(5)}  ${'0.4*sim'.padStart(7)}  title`,
  );
  for (const h of hits) {
    const weighted = (0.4 * h.simScore).toFixed(3);
    console.log(
      `   ${h.score.toFixed(2).padStart(5)}  ${h.techScore.toFixed(1).padStart(4)}  ${h.peScore.toFixed(1).padStart(4)}  ${h.simScore.toFixed(3).padStart(5)}  ${weighted.padStart(7)}  ${h.title}${peTag(h.peBacked)}  (${h.matchedTechs.join('+') || '—'})`,
    );
  }
}

async function run(label: string, input: SearchCasesInput) {
  const hits = await searchCases({ limit: 10, ...input });
  printHits(label, hits);
  return hits;
}

async function main() {
  const total = await prisma.caseStudy.count();
  const techRows = await prisma.caseTech.count();
  const chunks = await prisma.caseChunk.count();
  console.log(`Cases: ${total} | CaseTech rows: ${techRows} | CaseChunk rows: ${chunks}`);
  console.log('='.repeat(78));
  console.log('searchCases() — ranked hybrid (tech + PE + best-chunk sim)');
  console.log('score = techScore + peScore + 0.4 * simScore');
  console.log('='.repeat(78));

  console.log('\n### SINGLE ###');
  await run('n8n alone', { techs: ['n8n'] });
  await run('AWS alone', { techs: ['AWS'] });

  console.log('\n' + '='.repeat(78) + '\n### OR (techMatch: any) ###');
  await run('n8n OR AWS', {
    techs: ['n8n', 'AWS'],
    techMatch: 'any',
  });

  console.log('\n' + '='.repeat(78) + '\n### AND (techMatch: all) ###');
  await run('n8n AND AWS', {
    techs: ['n8n', 'AWS'],
    techMatch: 'all',
  });

  console.log('\n' + '='.repeat(78) + '\n### AND + PE required ###');
  await run('n8n AND AWS AND PE-backed', {
    techs: ['n8n', 'AWS'],
    techMatch: 'all',
    peMatch: 'required',
  });

  console.log('\n' + '='.repeat(78) + '\n### PURE SEMANTIC (no techs) ###');
  await run('query: "reduce customer support costs"', {
    query: 'reduce customer support costs',
  });

  const noPe = await prisma.caseStudy.count({ where: { peBacked: null } });
  if (noPe > 0) {
    console.log('\n' + '='.repeat(78));
    console.log(`⚠️  ${noPe}/${total} cases still have peBacked = null.`);
    console.log(`   peMatch:'required' ignores null; peScore treats null as 0.`);
  }

  if (chunks === 0) {
    console.log('\n' + '='.repeat(78));
    console.log('⚠️  CaseChunk is empty — simScore will be 0 until embed:cases runs.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
