/** Exact Anthropic token counts, with optional staging prompt TTFT diagnostics. */
import Anthropic from '@anthropic-ai/sdk';
import { assembleSystemPrompt } from '../lib/agent/systemPrompt';
import { tools } from '../lib/agent/tools';
import { prisma } from '../lib/db';
import { execFileSync } from 'child_process';
import { approvedCaseIndex, coreDocsPrompt } from '../lib/knowledge/approved/catalog';
import { ATTRIBUTION_RULES_PROMPT } from '../lib/knowledge/approved/attribution';
import { buildShareableDocsCatalog } from '../lib/agent/shareableDocs';
import { APPROVED_PRICING_PROMPT } from '../lib/agent/pricing';
import { APPROVED_CONTACTS_PROMPT } from '../lib/agent/contacts';

const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
const messages = [{ role: 'user' as const, content: 'Hello.' }];

async function count(model: string, system?: string, includeTools = false) {
  const result = await client.messages.countTokens({
    model,
    messages,
    ...(system ? { system } : {}),
    ...(includeTools ? { tools } : {}),
  });
  return result.input_tokens;
}

async function ttft(model: string, system: string): Promise<number> {
  const started = performance.now();
  const stream = client.messages.stream({
    model,
    max_tokens: 32,
    system,
    tools,
    messages: [{ role: 'user', content: 'Reply with one short greeting and do not use a tool.' }],
  });
  let first: number | null = null;
  stream.on('text', () => {
    if (first === null) first = Math.round(performance.now() - started);
  });
  await stream.finalMessage();
  return first ?? Math.round(performance.now() - started);
}

function templateAt(source: string, name: string): string {
  const nameAt = source.indexOf(name);
  const start = source.indexOf('`', nameAt) + 1;
  if (nameAt < 0 || start <= 0) throw new Error(`Template ${name} not found`);
  for (let index = start; index < source.length; index++) {
    if (source[index] === '`' && source[index - 1] !== '\\') {
      return source.slice(start, index).replace(/\\`/g, '`');
    }
  }
  throw new Error(`Template ${name} is unterminated`);
}

async function legacyPrompt(commit: string, voiceMode: boolean): Promise<string> {
  const show = (file: string) => execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8' });
  const base = templateAt(show('lib/agent/base-prompt.ts'), 'BASE_PROMPT');
  const guardSource = show('lib/agent/guardrails.ts');
  const guardrails = templateAt(guardSource, 'HARD_GUARDRAILS')
    .replace('${APPROVED_PRICING_PROMPT}', APPROVED_PRICING_PROMPT)
    .replace('${APPROVED_CONTACTS_PROMPT}', APPROVED_CONTACTS_PROMPT);
  const systemSource = show('lib/agent/systemPrompt.ts');
  const evidence = templateAt(systemSource, 'APPROVED_EVIDENCE_RULES');
  const voice = templateAt(systemSource, 'VOICE_REGISTER');
  const [caseIndex, shareable, core] = await Promise.all([
    approvedCaseIndex(),
    buildShareableDocsCatalog(),
    coreDocsPrompt(),
  ]);
  return [
    '===== LAYER 1: BASE (code fallback) =====', base, '',
    '===== LAYER 2: GUIDELINES (empty — no live version) =====',
    '(no live guidelines published yet)', '',
    '===== LAYER 3: CASE INDEX (auto-generated; not citable) =====',
    voiceMode ? '(omitted in low-latency voice mode; use search tools)' : caseIndex,
    '', '===== SHAREABLE DOCUMENTS (auto-generated from KnowledgeEntry) =====', shareable,
    ...(voiceMode ? ['', '===== VOICE REGISTER (git default; style only) =====', voice] : []),
    '', '===== APPROVED KNOWLEDGE (auto-generated from KnowledgeDoc) =====',
    evidence, '', ATTRIBUTION_RULES_PROMPT, '', core.text, '',
    '===== LAYER 4: HARD GUARDRAILS (code fallback, ALWAYS LAST) =====', guardrails,
  ].join('\n');
}

async function main() {
  const measureTtft = process.argv.includes('--ttft');
  const localOnly = process.argv.includes('--local-only');
  const baselineCommit = process.argv.find((arg) => arg.startsWith('--baseline-commit='))?.split('=')[1];
  const rows = [];
  for (const channel of ['chat', 'voice'] as const) {
    const model = channel === 'voice'
      ? process.env.ANTHROPIC_VOICE_MODEL || 'claude-haiku-4-5'
      : 'claude-sonnet-5';
    const prompt = await assembleSystemPrompt({ voiceMode: channel === 'voice' });
    const baseline = baselineCommit ? await legacyPrompt(baselineCommit, channel === 'voice') : null;
    const minimal = localOnly ? 0 : await count(model);
    const systemOnly = localOnly ? Math.round(prompt.length / 4) : await count(model, prompt) - minimal;
    const toolsOnly = localOnly ? 2513 : await count(model, undefined, true) - minimal;
    const combined = localOnly ? systemOnly + toolsOnly : await count(model, prompt, true) - minimal;
    const baselineTokens = baseline
      ? localOnly
        ? Math.round(baseline.length / 4)
        : (await count(model, baseline)) - minimal
      : null;
    rows.push({
      channel,
      model,
      chars: prompt.length,
      tokenMethod: localOnly ? 'chars/4 estimate; tools from prior Anthropic audit' : 'Anthropic countTokens',
      stablePromptTokens: systemOnly,
      toolTokens: toolsOnly,
      combinedTokens: combined,
      ...(baseline ? {
        baselineCommit,
        baselineChars: baseline.length,
        baselineStablePromptTokens: baselineTokens,
        reductionPercent: Number((((baselineTokens! - systemOnly) / baselineTokens!) * 100).toFixed(1)),
      } : {}),
      ...(measureTtft ? { ttftMs: await ttft(model, prompt) } : {}),
    });
  }
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
