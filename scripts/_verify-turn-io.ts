/**
 * Behavior check for the round-trip reduction: multi-turn history must stay
 * ordered and un-duplicated, and auto-titling must still fire on turn 1.
 */
import { prisma } from '../lib/db';
import { runAgentTurn } from '../lib/agent/loop';

async function main() {
  const user = await prisma.agentUser.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, email: true, affiliation: true },
  });
  if (!user) throw new Error('no AgentUser');

  const turns = ['hi', 'thanks', 'how are you'];
  let conversationId: string | undefined;
  for (const msg of turns) {
    const res = await runAgentTurn({
      userMessage: msg,
      agentUserId: user.id,
      agentUser: user,
      conversationId,
    });
    conversationId = res.conversationId;
  }

  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { title: true, updatedAt: true },
  });
  const msgs = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });

  console.log(`\ntitle: ${JSON.stringify(convo?.title)}`);
  console.log(`updatedAt: ${convo?.updatedAt.toISOString()}`);
  console.log(`messages (${msgs.length}):`);
  msgs.forEach((m, i) =>
    console.log(`  ${i + 1}. ${m.role.padEnd(9)} ${m.content.slice(0, 60)}`),
  );

  const userMsgs = msgs.filter((m) => m.role === 'user').map((m) => m.content);
  const ok =
    msgs.length === turns.length * 2 &&
    JSON.stringify(userMsgs) === JSON.stringify(turns) &&
    msgs.every((m, i) => (i % 2 === 0 ? m.role === 'user' : m.role === 'assistant')) &&
    convo?.title === 'hi';
  console.log(`\n${ok ? 'PASS' : 'FAIL'} — expected ${turns.length * 2} alternating messages, title "hi"`);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { deletedAt: new Date() },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
