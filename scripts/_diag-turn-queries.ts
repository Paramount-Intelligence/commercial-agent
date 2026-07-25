/**
 * Count the DB round-trips a single trivial turn makes, and time each one.
 * Uses a dedicated logging client so lib/db's shared client stays untouched.
 */
import { PrismaClient } from '@prisma/client';

const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });

type Row = { sql: string; ms: number };
const rows: Row[] = [];
let capturing = false;

// @ts-expect-error — event typing depends on the log config above
client.$on('query', (e: { query: string; duration: number }) => {
  if (capturing) rows.push({ sql: e.query, ms: e.duration });
});

async function main() {
  // Point the agent loop at this instrumented client.
  const g = globalThis as unknown as { prisma?: PrismaClient };
  g.prisma = client;

  const { runAgentTurn } = await import('../lib/agent/loop');
  const { readSession } = { readSession: null } as never;
  void readSession;

  const user = await client.agentUser.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!user) throw new Error('no AgentUser');

  // Warm the pool + Next-free module graph first.
  await runAgentTurn({ userMessage: 'hi', agentUserId: user.id });

  capturing = true;
  const t0 = performance.now();
  const res = await runAgentTurn({ userMessage: 'hi', agentUserId: user.id });
  const total = Math.round(performance.now() - t0);
  capturing = false;

  const engineMs = rows.reduce((a, r) => a + r.ms, 0);
  console.log(
    `\n=== ${rows.length} DB round-trips in runAgentTurn ("hi"), total ${total}ms ===`,
  );
  console.log(
    `engine-reported query time: ${engineMs}ms — the rest is network RTT\n`,
  );
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${r.ms}ms  ${r.sql.replace(/\s+/g, ' ').slice(0, 110)}`,
    );
  });

  await client.conversation.update({
    where: { id: res.conversationId },
    data: { deletedAt: new Date() },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
