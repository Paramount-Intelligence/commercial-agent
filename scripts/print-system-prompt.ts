/**
 * Print the assembled four-layer system prompt (no model call).
 *
 *   npm run prompt:print
 *   npx tsx --env-file=.env.local scripts/print-system-prompt.ts
 */
import {
  assembleSystemPromptDetailed,
  loadActiveBase,
  loadActiveGuidelines,
  loadActiveGuardrails,
} from '../lib/agent/systemPrompt';
import { prisma } from '../lib/db';

async function main() {
  const [base, guidelines, guardrails, assembled] = await Promise.all([
    loadActiveBase(),
    loadActiveGuidelines(),
    loadActiveGuardrails(),
    assembleSystemPromptDetailed(),
  ]);

  const prompt = assembled.prompt;
  console.log(prompt);
  console.log('\n' + '='.repeat(72));

  const i1 = prompt.search(/===== LAYER 1: BASE \([^)]+\) =====/);
  const i2 = prompt.search(/===== LAYER 2: GUIDELINES \([^)]+\) =====/);
  const i3 = prompt.search(/===== LAYER 3: CASE INDEX \([^)]+\) =====/);
  const i4 = prompt.search(/===== LAYER 4: HARD GUARDRAILS \([^)]+\) =====/);

  const orderOk = i1 >= 0 && i2 > i1 && i3 > i2 && i4 > i3;

  console.log('CHECKLIST:');
  console.log(`  [${i1 >= 0 && i1 === Math.min(i1, i2, i3, i4) ? 'x' : ' '}] base is first`);
  console.log(`  [${i2 > i1 ? 'x' : ' '}] guidelines second`);
  console.log(`  [${i3 > i2 ? 'x' : ' '}] case index third`);
  console.log(`  [${i4 > i3 && orderOk ? 'x' : ' '}] HARD_GUARDRAILS last`);
  console.log(`  [${orderOk ? 'x' : ' '}] layer order overall`);
  console.log(`  sources: base=${assembled.sources.base}, guidelines=${assembled.sources.guidelines}, caseIndex=${assembled.sources.caseIndex}, guardrails=${assembled.sources.guardrails}`);
  console.log(
    `  base: ${base.source} (${base.body.length} chars)`,
  );
  console.log(
    `  guidelines: ${guidelines ? `${guidelines.length} chars (live-from-DB)` : '(empty)'}`,
  );
  console.log(
    `  guardrails: ${guardrails.source} (${guardrails.body.length} chars)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
