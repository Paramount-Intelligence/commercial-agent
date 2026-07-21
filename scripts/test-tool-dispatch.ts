/**
 * Dispatch test — no model call. Exercises search_cases projection + unknown tool.
 *
 *   npm run tool:test
 *   npx tsx --env-file=.env.local scripts/test-tool-dispatch.ts
 */
import { dispatchTool } from '../lib/agent/tools';
import { prisma } from '../lib/db';

const TELEMETRY = ['score', 'techScore', 'peScore', 'simScore'] as const;

function assertProjection(label: string, result: {
  modelResult: Array<Record<string, unknown>>;
  retrievedIds: string[];
}): boolean {
  let ok = true;

  for (const row of result.modelResult) {
    for (const k of TELEMETRY) {
      if (k in row) {
        console.log(`FAIL [${label}] telemetry key present: ${k}`);
        ok = false;
      }
    }
    const summary = row.summary;
    if (typeof summary !== 'string' || summary.trim() === '') {
      console.log(`FAIL [${label}] empty summary on id=${row.id}`);
      ok = false;
    }
  }

  const fromModel = result.modelResult.map((r) => r.id as string);
  const idsMatch =
    fromModel.length === result.retrievedIds.length &&
    fromModel.every((id, i) => id === result.retrievedIds[i]);
  if (!idsMatch) {
    console.log(`FAIL [${label}] retrievedIds !== modelResult ids`);
    console.log('  modelResult ids:', fromModel);
    console.log('  retrievedIds:   ', result.retrievedIds);
    ok = false;
  }

  if (ok) console.log(`PASS [${label}] no telemetry, ids match, summaries non-empty`);
  return ok;
}

async function main() {
  let allOk = true;

  console.log('=== 1. techs: [n8n] ===');
  const r1 = await dispatchTool('search_cases', { techs: ['n8n'] });
  console.log('modelResult:\n', JSON.stringify(r1.modelResult, null, 2));
  console.log('retrievedIds:', r1.retrievedIds);
  allOk =
    assertProjection(
      'n8n',
      r1 as {
        modelResult: Array<Record<string, unknown>>;
        retrievedIds: string[];
      },
    ) && allOk;

  console.log('\n=== 2. query: reduce customer support costs ===');
  const r2 = await dispatchTool('search_cases', {
    query: 'reduce customer support costs',
  });
  console.log('modelResult:\n', JSON.stringify(r2.modelResult, null, 2));
  console.log('retrievedIds:', r2.retrievedIds);
  allOk =
    assertProjection(
      'semantic',
      r2 as {
        modelResult: Array<Record<string, unknown>>;
        retrievedIds: string[];
      },
    ) && allOk;

  console.log('\n=== 3. unknown tool ===');
  try {
    await dispatchTool('not_a_real_tool', {});
    console.log('FAIL [unknown] expected throw, got success');
    allOk = false;
  } catch (err) {
    console.log('PASS [unknown] threw:', err instanceof Error ? err.message : err);
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
