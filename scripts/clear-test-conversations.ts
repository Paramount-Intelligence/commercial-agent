/**
 * Clear smoke-test Conversation + Message rows for agent-loop@internal.local.
 * Message/Lead FKs are ON DELETE RESTRICT — delete children first, then conversations.
 *
 *   npx tsx --env-file=.env.local scripts/clear-test-conversations.ts           # dry-run
 *   npx tsx --env-file=.env.local scripts/clear-test-conversations.ts --confirm # delete
 */
import { prisma } from '../lib/db';

const CONFIRM = process.argv.includes('--confirm');
const TEST_EMAIL = 'agent-loop@internal.local';

async function main() {
  const user = await prisma.agentUser.findUnique({
    where: { email: TEST_EMAIL },
    select: { id: true, email: true },
  });

  if (!user) {
    console.log(`No AgentUser with email ${TEST_EMAIL} — nothing to clear.`);
    return;
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const convoIds = conversations.map((c) => c.id);
  const messageCount = conversations.reduce((n, c) => n + c._count.messages, 0);
  const leadCount =
    convoIds.length === 0
      ? 0
      : await prisma.lead.count({ where: { conversationId: { in: convoIds } } });

  console.log(`Target user: ${user.email} (${user.id})`);
  console.log(`Conversations: ${conversations.length}`);
  console.log(`Messages:      ${messageCount}`);
  console.log(`Leads:         ${leadCount}`);

  if (conversations.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  console.log('\nWould delete:');
  for (const c of conversations) {
    console.log(
      `  ${c.id}  ${c.createdAt.toISOString()}  messages=${c._count.messages}`,
    );
  }

  if (!CONFIRM) {
    console.log('\nDRY RUN — pass --confirm to delete.');
    return;
  }

  // RESTRICT: children first
  const deletedMessages = await prisma.message.deleteMany({
    where: { conversationId: { in: convoIds } },
  });
  const deletedLeads = await prisma.lead.deleteMany({
    where: { conversationId: { in: convoIds } },
  });
  const deletedConvos = await prisma.conversation.deleteMany({
    where: { id: { in: convoIds } },
  });

  console.log('\nDeleted:');
  console.log(`  conversations: ${deletedConvos.count}`);
  console.log(`  messages:      ${deletedMessages.count}`);
  console.log(`  leads:         ${deletedLeads.count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
