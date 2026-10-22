/** Print the assembled Phase 3a system prompt (no model call). */
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
  const baseAt = prompt.indexOf('===== IDENTITY AND KNOWLEDGE: BASE');
  const guardAt = prompt.indexOf('===== SAFETY: GUARDRAILS');
  const guideAt = prompt.indexOf('===== COMMERCIAL AND SHARED STYLE: GUIDELINES');
  const orderOk = baseAt >= 0 && guardAt > baseAt && guideAt > guardAt;
  console.log('CHECKLIST:');
  console.log(`  [${orderOk ? 'x' : ' '}] base -> guardrails -> guidelines`);
  console.log(`  [${prompt.includes('CHANNEL (code default)') ? 'x' : ' '}] selected channel block`);
  console.log(`  [${prompt.includes('EXAMPLES (code default)') ? 'x' : ' '}] selected examples`);
  console.log(`  sources: base=${assembled.sources.base}, guardrails=${assembled.sources.guardrails}, guidelines=${assembled.sources.guidelines}`);
  console.log(`  base: ${base.source} (${base.body.length} chars)`);
  console.log(`  guardrails: ${guardrails.source} (${guardrails.body.length} chars)`);
  console.log(`  guidelines: ${guidelines.length} chars`);
  console.log(`  assembled: ${prompt.length} chars`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
