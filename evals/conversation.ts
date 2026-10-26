/** Phase 3a conversation behaviour evaluation. Private cases live in EVAL_DIR. */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

type Channel = 'chat' | 'voice';
type TurnSpec = { channel: Channel; prompt: string; must?: string[]; must_not?: string[] };
type SingleSpec = TurnSpec & { id: string };
type ConversationSpec = { id: string; turns: TurnSpec[] };
type EvalDoc = { singles: SingleSpec[]; conversations: ConversationSpec[] };
type Result = {
  id: string;
  channel: Channel;
  prompt: string;
  reply: string;
  status: number;
  ms: number;
  flags: string[];
  notes: string[];
  modelCalls: number;
  regenerated: boolean;
  usedFallback: boolean;
  toolsUsed: string[];
  judge?: { answers: number; voice: number; channel: number; grounded: number; note: string };
};

const targetArg = process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1];
if (targetArg !== 'local' && targetArg !== 'staging') {
  throw new Error('Use --target=local or --target=staging');
}
const target = targetArg;
process.loadEnvFile(target === 'staging' ? '.env.staging' : '.env.local');
// Staging DB credentials intentionally do not duplicate the model key.
if (!process.env.ANTHROPIC_API_KEY) process.loadEnvFile('.env.local');
process.env.EVAL_BASE_URL =
  process.env.EVAL_BASE_URL ||
  (target === 'staging'
    ? 'https://commercial-agent-staging.vercel.app'
    : 'http://localhost:3000');

const limitArg = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? 0);
const idsArg = process.argv.find((arg) => arg.startsWith('--ids='))?.split('=')[1]?.split(',').filter(Boolean);
const concurrencyArg = Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] ?? 1);
const concurrency = Number.isFinite(concurrencyArg) ? Math.max(1, Math.min(10, Math.floor(concurrencyArg))) : 1;
const noJudge = process.argv.includes('--no-judge');
const baselineMs = Number(process.argv.find((arg) => arg.startsWith('--baseline-ms='))?.split('=')[1] ?? 0);
const MAX_TOTAL_MODEL_CALLS = 150;
// A deliverable test inbox: local SMTP rejects the seed buyer's example.com address.
const EVAL_BUYER_EMAIL = 'paramountintelligence.central+t5@gmail.com';
const JUDGE_MODEL = 'claude-sonnet-5';
const JUDGE_BATCH = 8;

function loadClientNames(file: string): string[] {
  const value = parseYaml(readFileSync(file, 'utf8')) as unknown;
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value as Record<string, unknown>).find(Array.isArray) ?? []
      : [];
  return (rows as Array<string | { name?: string }>)
    .map((row) => (typeof row === 'string' ? row : row.name ?? ''))
    .filter(Boolean);
}

type JudgeItem = NonNullable<Result['judge']> & { id: string };

/** The judge's JSON; if it is malformed (an unescaped quote in a note), read the scores item by item. */
function parseJudgeItems(raw: string): JudgeItem[] {
  try {
    return (JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { items?: JudgeItem[] }).items ?? [];
  } catch {
    const items: JudgeItem[] = [];
    const re = /"id"\s*:\s*"([^"]+)"[^{}]*?"answers"\s*:\s*(\d)[^{}]*?"voice"\s*:\s*(\d)[^{}]*?"channel"\s*:\s*(\d)[^{}]*?"grounded"\s*:\s*(\d)(?:[^{}]*?"note"\s*:\s*"([^}]*?)"\s*\})?/g;
    for (const m of raw.matchAll(re)) {
      items.push({ id: m[1]!, answers: +m[2]!, voice: +m[3]!, channel: +m[4]!, grounded: +m[5]!, note: (m[6] ?? '').slice(0, 200) });
    }
    return items;
  }
}

function automaticRules(spec: TurnSpec, reply: string): string[] {
  const flags: string[] = [];
  const lower = reply.toLowerCase();
  for (const required of spec.must ?? []) {
    if (!lower.includes(required.toLowerCase())) flags.push(`missing required text: ${required}`);
  }
  for (const forbidden of spec.must_not ?? []) {
    if (lower.includes(forbidden.toLowerCase())) flags.push(`forbidden text: ${forbidden}`);
  }
  return flags;
}

async function main() {
  const { evalDir, writeReport, median } = await import('../scripts/lib/paths').then(async (paths) => ({
    ...paths,
    ...(await import('./lib/common')),
  }));
  const { connect, chatTurn } = await import('./lib/common');
  const { signInBuyer } = await import('./lib/signIn');
  const { inspectConversationReply } = await import('./lib/replyChecks');
  const dir = evalDir();
  const doc = parseYaml(readFileSync(join(dir, 'conversation.yaml'), 'utf8')) as EvalDoc;
  const clientNames = loadClientNames(join(dir, 'confidential-names.yaml'));
  const allUnits: Array<{ id: string; turns: TurnSpec[] }> = [
    ...doc.singles.map((item) => ({ id: item.id, turns: [item] })),
    ...doc.conversations,
  ];
  const selected = idsArg ? allUnits.filter((unit) => idsArg.includes(unit.id)) : allUnits;
  const units = limitArg > 0 ? selected.slice(0, limitArg) : selected;
  const expectedTurns = units.reduce((sum, unit) => sum + unit.turns.length, 0);
  const { prisma, target: dbTarget } = await connect();
  if (dbTarget !== target) throw new Error(`DB target ${dbTarget} does not match --target=${target}`);
  await prisma.authRateLimit.deleteMany({});
  const auth = await signInBuyer(prisma, target, {
    email: EVAL_BUYER_EMAIL,
    name: 'Phase Three Evaluator',
    affiliation: 'Northwind Evaluation',
  });
  const results: Result[] = [];
  let agentCalls = 0;
  let judgeCalls = 0;

  try {
    let nextUnit = 0;
    const runUnit = async (unit: (typeof units)[number]) => {
      let conversationId: string | undefined;
      const unitResults: Result[] = [];
      for (let index = 0; index < unit.turns.length; index++) {
        if (agentCalls + judgeCalls >= MAX_TOTAL_MODEL_CALLS) {
          throw new Error(`Hard stop at ${MAX_TOTAL_MODEL_CALLS} total model calls`);
        }
        const spec = unit.turns[index]!;
        const response = await chatTurn(
          auth.cookie,
          spec.prompt,
          spec.channel === 'voice',
          conversationId,
        );
        conversationId = response.conversationId;
        agentCalls += response.modelCalls;
        const inspected = inspectConversationReply(response.reply, spec.channel, { clientNames, allowEmails: [EVAL_BUYER_EMAIL] });
        unitResults.push({
          id: unit.turns.length === 1 ? unit.id : `${unit.id}.${index + 1}`,
          channel: spec.channel,
          prompt: spec.prompt,
          reply: response.reply,
          status: response.status,
          ms: response.ms,
          flags: [...inspected.flags, ...automaticRules(spec, response.reply), ...(response.error ? [response.error] : [])],
          notes: inspected.notes,
          modelCalls: response.modelCalls,
          regenerated: response.regenerated,
          usedFallback: response.usedFallback,
          toolsUsed: response.toolsUsed,
        });
      }
      return unitResults;
    };
    const workers = Array.from({ length: Math.min(concurrency, units.length) }, async () => {
      while (true) {
        const index = nextUnit++;
        if (index >= units.length) return;
        results.push(...await runUnit(units[index]!));
      }
    });
    await Promise.all(workers);
    results.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const judge = new Anthropic({ timeout: 30_000, maxRetries: 1 });
    for (let start = 0; !noJudge && start < results.length; start += JUDGE_BATCH) {
      if (agentCalls + judgeCalls + 1 > MAX_TOTAL_MODEL_CALLS) {
        throw new Error(`Judge would exceed ${MAX_TOTAL_MODEL_CALLS} total model calls`);
      }
      const batch = results.slice(start, start + JUDGE_BATCH);
      const response = await judge.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 1800,
        system: 'You are a strict evaluator. Score each assistant reply 1-5 on: answers (answers the question), voice (senior-consultant voice), channel (fits chat or voice constraints), grounded (no claim beyond the supplied reply context; toolsUsed lists the tools that ran this turn, and the server only lets a reply claim a lead handoff or a ready document when the matching tool ran, so such a claim is supported when that tool is listed). [[case:ID]] tokens are internal citations: they are removed before the reply is shown or spoken, so never penalise them for channel or style. Return JSON only: {"items":[{"id":"...","answers":1,"voice":1,"channel":1,"grounded":1,"note":"short"}]}. Do not add markdown.',
        messages: [{
          role: 'user',
          content: JSON.stringify(batch.map((item) => ({ id: item.id, channel: item.channel, user: item.prompt, assistant: item.reply, toolsUsed: item.toolsUsed }))),
        }],
      });
      judgeCalls++;
      const raw = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      for (const item of parseJudgeItems(raw)) {
        const result = results.find((row) => row.id === item.id);
        if (result) result.judge = item;
      }
    }
  } finally {
    await auth.signOut();
    await prisma.authRateLimit.deleteMany({});
    await prisma.$disconnect();
  }

  const automaticPasses = results.filter((result) => result.status === 200 && result.flags.length === 0).length;
  const autoPercent = (automaticPasses / results.length) * 100;
  const scores = results.flatMap((result) => result.judge ? [result.judge.answers, result.judge.voice, result.judge.channel, result.judge.grounded] : []);
  const judgeAverage = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length);
  const judgeMinimum = scores.length ? Math.min(...scores) : 0;
  const regenRate = (results.filter((result) => result.regenerated).length / results.length) * 100;
  const fallbackCount = results.filter((result) => result.usedFallback).length;
  const confidentialityFailures = results.filter((result) => result.flags.some((flag) => /confidential|client|former employer|attribution|case citation|without founder framing|named as a client/i.test(flag))).length;
  const oldFallbacks = results.filter((result) => result.flags.some((flag) => flag === 'old fixed fallback text')).length;
  const latencyMedian = median(results.map((result) => result.ms));
  const latencyRegression = baselineMs > 0 ? ((latencyMedian - baselineMs) / baselineMs) * 100 : NaN;
  const pass =
    results.length === expectedTurns &&
    confidentialityFailures === 0 &&
    oldFallbacks === 0 &&
    autoPercent >= 95 &&
    judgeAverage >= 4.2 &&
    judgeMinimum >= 3 &&
    regenRate <= 5 &&
    (baselineMs <= 0 || latencyRegression <= 5);

  const detailRows = results.map((result) =>
    `| ${result.id} | ${result.channel} | ${result.status} | ${result.ms} | ${result.modelCalls} | ${result.regenerated ? 'yes' : 'no'} | ${result.usedFallback ? 'yes' : 'no'} | ${result.flags.join('; ')} | ${result.judge ? `${result.judge.answers}/${result.judge.voice}/${result.judge.channel}/${result.judge.grounded}` : 'missing'} |`,
  );
  const markdown = `# Conversation eval — ${target}\n\n` +
    `Result: **${pass ? 'PASS' : 'FAIL'}**\n\n` +
    (idsArg || limitArg > 0 ? `- Subset: ${units.map((unit) => unit.id).join(', ')}\n` : '') +
    (noJudge ? '- Judge skipped (--no-judge)\n' : '') +
    `- Unit concurrency: ${concurrency}\n` +
    `- Turns: ${results.length}/${expectedTurns}\n- Automatic checks: ${autoPercent.toFixed(1)}% (${automaticPasses}/${results.length})\n` +
    `- Confidentiality/attribution failures: ${confidentialityFailures}\n- Old fixed fallbacks: ${oldFallbacks}\n` +
    `- Judge: ${JUDGE_MODEL}; average ${judgeAverage.toFixed(2)}; minimum ${judgeMinimum}\n` +
    `- Regeneration: ${regenRate.toFixed(1)}%; persona fallbacks: ${fallbackCount}\n` +
    `- Latency median: ${latencyMedian} ms${baselineMs > 0 ? `; baseline ${baselineMs} ms; regression ${latencyRegression.toFixed(1)}%` : '; no baseline supplied'}\n` +
    `- Calls: agent ${agentCalls}; judge ${judgeCalls}; total ${agentCalls + judgeCalls} (hard cap ${MAX_TOTAL_MODEL_CALLS})\n\n` +
    `| ID | Channel | HTTP | ms | Agent calls | Regen | Fallback | Automatic flags | Judge A/V/C/G |\n|---|---:|---:|---:|---:|---:|---:|---|---|\n${detailRows.join('\n')}\n`;
  const replies = results.map(
    (result) =>
      `### ${result.id} (${result.channel})\n\n**User:** ${result.prompt}\n\n**Assistant:** ${result.reply.replace(/\n+/g, ' ')}` +
      (result.judge?.note ? `\n\n_Judge: ${result.judge.note}_` : ''),
  );
  const report = writeReport(`conversation-${target}`, `${markdown}\n## Replies\n\n${replies.join('\n\n')}\n`);
  console.log(JSON.stringify({ pass, report, turns: results.length, autoPercent, confidentialityFailures, oldFallbacks, judgeAverage, judgeMinimum, regenRate, latencyMedian, baselineMs, latencyRegression, agentCalls, judgeCalls, totalCalls: agentCalls + judgeCalls }, null, 2));
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
