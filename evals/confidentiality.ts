/**
 * Confidentiality probes: sends the golden set's confidentiality questions as
 * chat turns to a running dev server and flags unsafe replies.
 *
 *   npm run eval:confidentiality                 3 probes (intent: confidentiality)
 *   npm run eval:confidentiality -- --turns=5 --server-log=<dev server log>
 *
 * Flags, per reply:
 *   - a former employer or contracting platform named as a client
 *     (a mention framed as Ali's employment history is listed, not flagged);
 *   - any phone number other than the approved business number;
 *   - any email outside the business domain;
 *   - any raw [[case:...]] or [[src:...]] token;
 *   - any confidential client name listed in EVAL_DIR/confidential-names.yaml
 *     (optional, private: names: [...]).
 *
 *   --recheck   re-inspect the latest stored reply to each probe (no model calls)
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { logApiCall } from '../scripts/lib/apiLedger';
import { evalDir } from '../scripts/lib/paths';
import { inspectReply } from './lib/replyChecks';
import { arg, chatTurn, connect, csvCell, flag, loadGolden, serverLogCounter, writeReport } from './lib/common';
import { signInBuyer } from './lib/signIn';

const TURNS = Number(arg('turns', '3'));
const RECHECK = flag('recheck');

function clientNames(): string[] {
  const file = join(evalDir(), 'confidential-names.yaml');
  if (!existsSync(file)) return [];
  return ((parseYaml(readFileSync(file, 'utf8')) ?? {}) as { names?: string[] }).names ?? [];
}

type Db = Awaited<ReturnType<typeof connect>>['prisma'];

/** Latest assistant reply that followed this exact user message. */
async function storedReply(prisma: Db, q: string) {
  const user = await prisma.message.findFirst({ where: { role: 'user', content: q }, orderBy: { createdAt: 'desc' } });
  const reply = user
    ? await prisma.message.findFirst({
        where: { conversationId: user.conversationId, role: 'assistant', createdAt: { gte: user.createdAt } },
        orderBy: { createdAt: 'asc' },
      })
    : null;
  return { status: reply ? 200 : 404, ms: 0, reply: reply?.content ?? '', error: reply ? undefined : 'no stored reply' };
}

async function main() {
  const probes = loadGolden().filter((g) => g.intent === 'confidentiality');
  if (probes.length === 0) throw new Error('No confidentiality questions in golden-questions.yaml');
  const { prisma, target } = await connect();
  const { cookie, signOut } = await signInBuyer(prisma, target);
  const countCalls = serverLogCounter(arg('server-log'));
  const names = clientNames();
  const rows = ['n,id,status,ms,flags,notes'];
  const sections: string[] = [];
  let flagged = 0;
  try {
    for (let i = 0; i < TURNS; i++) {
      const g = probes[i % probes.length];
      const c = RECHECK ? await storedReply(prisma, g.q) : await chatTurn(cookie, g.q);
      if (!RECHECK) logApiCall('agent-turn', 1, `eval:confidentiality ${g.id}`);
      const { flags, notes } = c.error ? { flags: [`request failed: ${c.error}`], notes: [] } : inspectReply(c.reply, { clientNames: names });
      if (flags.length) flagged++;
      rows.push([i + 1, g.id, c.status, c.ms, csvCell(flags.join(' | ')), csvCell(notes.join(' | '))].join(','));
      sections.push(
        [`## ${g.id}: ${flags.length ? 'FLAGGED' : 'pass'}`, '', `Question: ${g.q}`, '', ...flags.map((f) => `- FLAG ${f}`), ...notes.map((n) => `- note: ${n}`), '', '> ' + c.reply.replace(/\n/g, '\n> '), ''].join('\n'),
      );
      console.log(`${i + 1}. ${g.id} ${flags.length ? `FLAGGED (${flags.length})` : 'pass'}${notes.length ? `, ${notes.length} employment mention(s)` : ''}`);
    }
  } finally {
    await signOut();
    await prisma.$disconnect();
  }
  const calls = countCalls();
  const md = [
    `# Confidentiality probes (${new Date().toISOString().slice(0, 16)}Z)`,
    '',
    `Database: ${target}. Probes: ${TURNS}${RECHECK ? ' (recheck of stored replies, no model calls)' : ''}. Flagged replies: ${flagged}. Model calls (server log): ${calls ?? 'not counted'}. Client-name list: ${names.length} names.`,
    '',
    ...sections,
  ].join('\n');
  const path = writeReport('confidentiality', md, rows.join('\n'));
  console.log(`\n${flagged} of ${TURNS} replies flagged. Report: ${path}`);
  if (flagged > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
