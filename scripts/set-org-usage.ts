/**
 * View or set an org's OrgUsageDay counters for TODAY (UTC).
 *
 *   npm run org:usage -- "Catalant"        → show today's used/limit
 *   npm run org:usage -- "Catalant" 999    → set messageCount to 999, then show
 *   npm run org:usage -- "Catalant" --llmTokens 999900 --ttsChars 149900
 *
 * Accepts the org's name or email.
 */
import { prisma } from '../lib/db';

function utcToday(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

async function main() {
  const nameOrEmail = process.argv[2]?.trim();
  const args = process.argv.slice(3);

  if (!nameOrEmail) {
    console.error(
      'Usage: npm run org:usage -- "<org name or email>" [count] [--messages N] [--llmTokens N] [--ttsChars N] [--sttSeconds N]',
    );
    process.exitCode = 1;
    return;
  }

  const org = await prisma.organization.findFirst({
    where: { OR: [{ email: nameOrEmail.toLowerCase() }, { name: nameOrEmail }] },
    select: {
      id: true,
      name: true,
      email: true,
      dailyMsgLimit: true,
      dailyLlmTokenLimit: true,
      dailyTtsCharLimit: true,
      dailySttSecondLimit: true,
      active: true,
    },
  });
  if (!org) {
    console.error(`Organization not found: "${nameOrEmail}" (tried email and name)`);
    process.exitCode = 1;
    return;
  }

  const day = utcToday();

  const updates: {
    messageCount?: number;
    llmTokens?: number;
    ttsChars?: number;
    sttSeconds?: number;
  } = {};
  let index = 0;
  if (args[0] && !args[0].startsWith('--')) {
    updates.messageCount = Number(args[0]);
    index = 1;
  }
  const flagToField = {
    '--messages': 'messageCount',
    '--llmTokens': 'llmTokens',
    '--llm-tokens': 'llmTokens',
    '--ttsChars': 'ttsChars',
    '--tts-chars': 'ttsChars',
    '--sttSeconds': 'sttSeconds',
    '--stt-seconds': 'sttSeconds',
  } as const;
  while (index < args.length) {
    const flag = args[index] as keyof typeof flagToField;
    const field = flagToField[flag];
    const value = Number(args[index + 1]);
    if (!field || args[index + 1] === undefined) {
      console.error(`Unknown or incomplete flag: "${args[index]}"`);
      process.exitCode = 1;
      return;
    }
    updates[field] = value;
    index += 2;
  }

  for (const [field, value] of Object.entries(updates)) {
    if (!Number.isInteger(value) || value < 0) {
      console.error(`${field} must be a non-negative integer, got "${value}"`);
      process.exitCode = 1;
      return;
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.orgUsageDay.upsert({
      where: { day_organizationId: { day, organizationId: org.id } },
      update: updates,
      create: { day, organizationId: org.id, ...updates },
    });
    console.log(
      `Set ${Object.entries(updates)
        .map(([field, value]) => `${field}=${value}`)
        .join(', ')} for ${day.toISOString().slice(0, 10)} (UTC).`,
    );
  }

  const usage = await prisma.orgUsageDay.findUnique({
    where: { day_organizationId: { day, organizationId: org.id } },
    select: {
      messageCount: true,
      llmTokens: true,
      ttsChars: true,
      sttSeconds: true,
    },
  });

  console.log('');
  console.log(`Organization : ${org.name} <${org.email}>${org.active ? '' : '  [INACTIVE]'}`);
  console.log(`Day (UTC)    : ${day.toISOString().slice(0, 10)}`);
  console.log(`Messages     : ${usage?.messageCount ?? 0} / ${org.dailyMsgLimit}`);
  console.log(
    `TTS chars    : ${usage?.ttsChars ?? 0} / ${org.dailyTtsCharLimit}`,
  );
  console.log(
    `STT seconds  : ${usage?.sttSeconds ?? 0} / ${org.dailySttSecondLimit}`,
  );
  console.log(
    `LLM tokens   : ${usage?.llmTokens ?? 0} / ${org.dailyLlmTokenLimit}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
