/**
 * Isolate where a trivial turn spends time: DB round-trips vs prompt assembly
 * vs the Anthropic call itself. Run twice — second run is "warm".
 */
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/db';
import { assembleSystemPrompt } from '../lib/agent/systemPrompt';

const ms = (t: number) => Math.round(performance.now() - t);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const out = await fn();
  console.log(`  ${label}: ${ms(t)}ms`);
  return out;
}

async function main() {
  console.log('=== DB round-trip probe ===');
  await timed('warmup SELECT 1', () => prisma.$queryRaw`SELECT 1`);
  for (let i = 0; i < 3; i++) {
    await timed(`SELECT 1 #${i + 1}`, () => prisma.$queryRaw`SELECT 1`);
  }

  console.log('\n=== Prompt-assembly queries (per turn) ===');
  await timed('promptVersion base', () =>
    prisma.promptVersion.findFirst({
      where: { layer: 'base', isLive: true },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    }),
  );
  await timed('promptVersion guidelines', () =>
    prisma.promptVersion.findFirst({
      where: { layer: 'guidelines', isLive: true },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    }),
  );
  await timed('promptVersion guardrails', () =>
    prisma.promptVersion.findFirst({
      where: { layer: 'guardrails', isLive: true },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    }),
  );
  await timed('caseStudy index query', () =>
    prisma.caseStudy.findMany({
      select: { title: true, peBacked: true, techTags: { select: { name: true } } },
      orderBy: { title: 'asc' },
    }),
  );
  await timed('knowledgeEntry shareable', () =>
    prisma.knowledgeEntry.findMany({
      where: { shareable: true, fileUrl: { not: null } },
      select: { id: true, title: true, shareLabel: true },
    }),
  );

  console.log('\n=== assembleSystemPrompt (full, conversational) ===');
  const slim = await timed('assemble omitCaseIndex=true', () =>
    assembleSystemPrompt({ omitCaseIndex: true }),
  );
  const full = await timed('assemble omitCaseIndex=false', () =>
    assembleSystemPrompt({}),
  );
  console.log(
    `  slim chars=${slim.length} (~${Math.round(slim.length / 4)} tok), full chars=${full.length} (~${Math.round(full.length / 4)} tok)`,
  );

  console.log('\n=== Anthropic call latency: same "hi" prompt ===');
  const anthropic = new Anthropic({ maxRetries: 0 });
  const models = ['claude-haiku-4-5', 'claude-sonnet-5'];
  for (const model of models) {
    for (const attempt of [1, 2]) {
      const t = performance.now();
      try {
        const res = await anthropic.messages.create({
          model,
          max_tokens: 700,
          system: slim,
          messages: [{ role: 'user', content: 'hi' }],
        });
        console.log(
          `  ${model} attempt ${attempt}: ${ms(t)}ms  in=${res.usage?.input_tokens} out=${res.usage?.output_tokens}`,
        );
      } catch (e) {
        console.log(
          `  ${model} attempt ${attempt}: FAILED after ${ms(t)}ms — ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
