/**
 * Warm per-phase breakdown for a trivial greeting turn, measured against the
 * real runAgentTurn (no dev-server compilation in the way).
 *
 * Also times the two route-level pre-turn steps (session read + org quotas)
 * as raw queries so the whole request can be accounted for.
 */
import { prisma } from '../lib/db';
import { runAgentTurn } from '../lib/agent/loop';

const ms = (t: number) => Math.round(performance.now() - t);

async function main() {
  const user = await prisma.agentUser.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, organizationId: true },
  });
  if (!user) throw new Error('no AgentUser found');
  console.log(`agentUser=${user.email}\n`);

  console.log('=== route pre-turn steps (raw query timings) ===');
  let t = performance.now();
  await prisma.session.findFirst({
    where: { agentUserId: user.id },
    include: { agentUser: true },
  });
  console.log(`  session lookup: ${ms(t)}ms`);
  t = performance.now();
  await prisma.organization.findUnique({ where: { id: user.organizationId } });
  console.log(`  organization lookup: ${ms(t)}ms`);

  t = performance.now();
  await prisma.orgUsageDay.findFirst({
    where: { organizationId: user.organizationId },
  });
  console.log(`  orgUsageDay read (token quota): ${ms(t)}ms`);
  t = performance.now();
  await prisma.orgUsageDay.findFirst({
    where: { organizationId: user.organizationId },
  });
  console.log(`  orgUsageDay read + reserve (msg quota): ${ms(t)}ms`);

  for (const attempt of [1, 2, 3]) {
    console.log(`\n=== runAgentTurn("hi") attempt ${attempt} ===`);
    const t0 = performance.now();
    const res = await runAgentTurn({
      userMessage: 'hi',
      agentUserId: user.id,
    });
    console.log(
      `  TOTAL runAgentTurn: ${ms(t0)}ms  out=${res.tokensOut} in=${res.tokensIn}`,
    );
    console.log(`  reply: ${res.reply.slice(0, 80)}`);
    // Soft-delete the throwaway conversation so it doesn't pollute the sidebar.
    await prisma.conversation.update({
      where: { id: res.conversationId },
      data: { deletedAt: new Date() },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
