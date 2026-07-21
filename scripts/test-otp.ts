/**
 * OTP lifecycle logic test — no email, no HTTP. Exercises issueCode/checkCode
 * against a real AgentUser row.
 *
 *   npm run otp:test -- <agentUserId>
 *   npx tsx --env-file=.env.local scripts/test-otp.ts <agentUserId>
 *
 * Flow: issue → wrong code (attempts+1) → right code (consumed) → immediate
 * reissue (rate-limited).
 */
import { prisma } from '../lib/db';
import { issueCode, checkCode } from '../lib/auth/verification';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const userId = process.argv[2]?.trim();
  if (!userId) {
    console.error('Usage: npm run otp:test -- <agentUserId>');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.agentUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) fail(`No AgentUser with id ${userId}`);
  console.log(`Testing OTP lifecycle for ${user.email} (${user.id})\n`);

  // Clean slate so the 60s cooldown from a previous test run can't interfere
  await prisma.emailVerification.deleteMany({ where: { agentUserId: userId } });

  // 1. issue
  const issued = await issueCode(userId);
  if (!issued.ok) fail(`expected issue to succeed, got ${JSON.stringify(issued)}`);
  console.log(`1. issued code: ${issued.code}`);

  const row = await prisma.emailVerification.findFirst({
    where: { agentUserId: userId, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) fail('no EmailVerification row written');
  if (row.codeHash === issued.code) fail('plaintext code stored — must be hashed!');
  console.log(
    `   row written: id=${row.id} attempts=${row.attempts} expiresAt=${row.expiresAt.toISOString()}`,
  );

  // 2. wrong code → ok:false + attempts incremented
  const wrongCode = issued.code === '000000' ? '999999' : '000000';
  const wrong = await checkCode(userId, wrongCode);
  if (wrong.ok) fail('wrong code was accepted');
  const afterWrong = await prisma.emailVerification.findUnique({ where: { id: row.id } });
  if (afterWrong?.attempts !== 1) fail(`attempts should be 1, got ${afterWrong?.attempts}`);
  console.log(`2. wrong code rejected (reason=${wrong.reason}), attempts=1 ✓`);

  // 3. right code → ok:true + consumed
  const right = await checkCode(userId, issued.code);
  if (!right.ok) fail(`correct code rejected: ${JSON.stringify(right)}`);
  const afterRight = await prisma.emailVerification.findUnique({ where: { id: row.id } });
  if (!afterRight?.consumedAt) fail('code not marked consumed after success');
  console.log('3. correct code accepted, consumedAt set ✓');

  // 4. replay: consumed code must not verify again
  const replay = await checkCode(userId, issued.code);
  if (replay.ok) fail('consumed code was accepted again (replay!)');
  console.log(`4. replay rejected (reason=${replay.reason}) ✓`);

  // 5. immediate reissue → rate-limited?? No: prior code is CONSUMED, so reissue
  //    is allowed. Issue fresh, then a second immediate issue must rate-limit.
  const fresh = await issueCode(userId);
  if (!fresh.ok) fail(`fresh issue should succeed, got ${JSON.stringify(fresh)}`);
  const limited = await issueCode(userId);
  if (limited.ok) fail('second immediate issue was NOT rate-limited');
  console.log(
    `5. immediate reissue rate-limited ✓ (retry in ${limited.retryAfterSeconds}s)`,
  );

  // Tidy up test rows
  await prisma.emailVerification.deleteMany({ where: { agentUserId: userId } });
  console.log('\nALL OTP LIFECYCLE CHECKS PASSED');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
