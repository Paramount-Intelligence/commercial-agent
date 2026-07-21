/**
 * Live agent-loop smoke test (REAL Anthropic calls).
 * Requires ANTHROPIC_API_KEY in .env.local.
 *
 * runAgentTurn now REQUIRES an agentUserId (the test-user fallback is retired):
 *   npm run agent:test                       → uses the most recent AgentUser
 *   npx tsx --env-file=.env.local scripts/test-agent-turn.ts <agentUserId>
 */
import { runAgentTurn } from '../lib/agent/loop';
import { prisma } from '../lib/db';

async function printTurn(
  label: string,
  result: Awaited<ReturnType<typeof runAgentTurn>>,
) {
  console.log('\n' + '='.repeat(72));
  console.log(label);
  console.log('conversationId:', result.conversationId);
  console.log('usedFallback:  ', result.usedFallback);
  console.log('citedIds:      ', result.citedIds);
  console.log('--- reply ---');
  console.log(result.reply);
}

async function resolveTestUserId(): Promise<string> {
  const argId = process.argv[2]?.trim();
  if (argId) {
    const user = await prisma.agentUser.findUnique({ where: { id: argId } });
    if (!user) throw new Error(`AgentUser not found: ${argId}`);
    return user.id;
  }
  const latest = await prisma.agentUser.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true },
  });
  if (!latest) {
    throw new Error(
      'No AgentUser exists — complete the /login flow once (or pass an id: ' +
        'npx tsx --env-file=.env.local scripts/test-agent-turn.ts <agentUserId>)',
    );
  }
  console.log(`Using most recent AgentUser: ${latest.email} (${latest.id})`);
  return latest.id;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set (add it to .env.local)');
  }

  const agentUserId = await resolveTestUserId();

  const t1 = await runAgentTurn({
    agentUserId,
    userMessage: 'Do you have experience with n8n and AWS?',
  });
  await printTurn('Turn 1 — n8n + AWS', t1);

  const t2 = await runAgentTurn({
    agentUserId,
    conversationId: t1.conversationId,
    userMessage: 'Tell me more about that first one.',
  });
  await printTurn('Turn 2 — follow-up (multi-turn + retrievedIds)', t2);

  const t3 = await runAgentTurn({
    agentUserId,
    conversationId: t1.conversationId,
    userMessage: 'How much did that project cost?',
  });
  await printTurn('Turn 3 — pricing deflect', t3);

  console.log('\n' + '='.repeat(72));
  console.log('LOGGED TRANSCRIPT (Message rows in order)');
  const messages = await prisma.message.findMany({
    where: { conversationId: t1.conversationId },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      content: true,
      citedCaseIds: true,
      retrievedCaseIds: true,
      toolsUsed: true,
      tokensIn: true,
      tokensOut: true,
      createdAt: true,
    },
  });

  for (const [i, m] of messages.entries()) {
    console.log(`\n--- [${i}] ${m.role} @ ${m.createdAt.toISOString()} ---`);
    console.log(m.content.slice(0, 500) + (m.content.length > 500 ? '…' : ''));
    console.log('citedCaseIds:    ', m.citedCaseIds);
    console.log('retrievedCaseIds:', m.retrievedCaseIds);
    console.log('toolsUsed:       ', m.toolsUsed);
    console.log('tokens:          ', { in: m.tokensIn, out: m.tokensOut });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
