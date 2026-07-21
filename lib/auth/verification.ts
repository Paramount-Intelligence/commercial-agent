/**
 * OTP lifecycle over EmailVerification. Pure lifecycle — no HTTP, no user
 * creation, no email sending (callers pass the returned code to the mailer).
 *
 * Guarantees:
 * - plaintext codes never persist (bcrypt hash only)
 * - max one active code per user (issuing supersedes prior unconsumed codes)
 * - min 60s between issues per user (anti email-bombing)
 * - 5 wrong attempts force-consume the code (anti brute-force; user must resend)
 */
import { prisma } from '../db';
import { generateCode, hashCode, verifyCode } from './otp';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
const REISSUE_COOLDOWN_MS = 60 * 1000; // 60 s
const MAX_ATTEMPTS = 5;

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export type CheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'no_active_code' | 'wrong_code' | 'too_many_attempts';
      attemptsRemaining?: number;
    };

export async function issueCode(agentUserId: string): Promise<IssueResult> {
  const now = new Date();

  // Anti-spam: an unconsumed, unexpired code issued < 60s ago blocks reissue
  const recent = await prisma.emailVerification.findFirst({
    where: {
      agentUserId,
      consumedAt: null,
      expiresAt: { gt: now },
      createdAt: { gt: new Date(now.getTime() - REISSUE_COOLDOWN_MS) },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (recent) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((recent.createdAt.getTime() + REISSUE_COOLDOWN_MS - now.getTime()) / 1000),
    );
    return { ok: false, reason: 'rate_limited', retryAfterSeconds };
  }

  const code = generateCode();
  const codeHash = await hashCode(code);

  // Supersede all prior unconsumed codes, then create the only-valid latest one
  await prisma.$transaction([
    prisma.emailVerification.updateMany({
      where: { agentUserId, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.emailVerification.create({
      data: {
        agentUserId,
        codeHash,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
    }),
  ]);

  // Plaintext code goes ONLY to the caller (→ mailer); it is never persisted
  return { ok: true, code };
}

export async function checkCode(
  agentUserId: string,
  submittedCode: string,
): Promise<CheckResult> {
  const now = new Date();

  const active = await prisma.emailVerification.findFirst({
    where: { agentUserId, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true, attempts: true },
  });

  if (!active) {
    return { ok: false, reason: 'no_active_code' };
  }

  const matches = await verifyCode(submittedCode.trim(), active.codeHash);

  if (matches) {
    await prisma.emailVerification.update({
      where: { id: active.id },
      data: { consumedAt: now },
    });
    return { ok: true };
  }

  const attempts = active.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  await prisma.emailVerification.update({
    where: { id: active.id },
    data: {
      attempts,
      // Force-consume on the last allowed attempt — user must request a new code
      ...(exhausted ? { consumedAt: now } : {}),
    },
  });

  return exhausted
    ? { ok: false, reason: 'too_many_attempts' }
    : { ok: false, reason: 'wrong_code', attemptsRemaining: MAX_ATTEMPTS - attempts };
}
