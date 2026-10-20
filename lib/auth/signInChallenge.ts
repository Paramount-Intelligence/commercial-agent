/**
 * Pending sign-ins (SignInChallenge). identify starts one; verify-code checks
 * it. Nothing about the user or organization is written until the code is
 * verified, and every sign-in needs a fresh code.
 *
 * Guarantees (unchanged from the earlier per-user codes):
 * - codes are 6 digits, stored bcrypt-hashed only, valid 10 minutes, single use
 * - one active challenge per (email, org); starting a new one supersedes it
 * - at least 60 s between codes for the same (email, org)
 * - 5 wrong attempts consume the challenge
 *
 * The logic takes a small store so it can be unit-tested without a database.
 */
import { prisma } from '../db';
import { generateCode, hashCode, verifyCode } from './otp';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const REISSUE_COOLDOWN_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;

export type ChallengeRow = {
  id: string;
  email: string;
  organizationId: string;
  name: string;
  affiliation: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type ChallengeStore = {
  latestActive(email: string, orgId: string, now: Date): Promise<ChallengeRow | null>;
  create(row: Omit<ChallengeRow, 'id' | 'attempts' | 'consumedAt' | 'createdAt'>, now: Date): Promise<void>;
  consumeAllActive(email: string, orgId: string, now: Date): Promise<void>;
  update(id: string, data: { attempts?: number; consumedAt?: Date }): Promise<void>;
  /** Mark consumed only if still unconsumed; true for exactly one caller. */
  consume(id: string, now: Date): Promise<boolean>;
};

export const prismaChallengeStore: ChallengeStore = {
  latestActive: (email, orgId, now) =>
    prisma.signInChallenge.findFirst({
      where: { email, organizationId: orgId, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    }),
  async create(row, now) {
    await prisma.signInChallenge.create({ data: { ...row, createdAt: now } });
  },
  async consumeAllActive(email, orgId, now) {
    await prisma.signInChallenge.updateMany({
      where: { email, organizationId: orgId, consumedAt: null },
      data: { consumedAt: now },
    });
  },
  async update(id, data) {
    await prisma.signInChallenge.update({ where: { id }, data });
  },
  async consume(id, now) {
    const r = await prisma.signInChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: now } });
    return r.count === 1;
  },
};

export type StartResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export type CheckResult =
  | { ok: true; name: string; affiliation: string }
  | {
      ok: false;
      reason: 'no_active_code' | 'wrong_code' | 'too_many_attempts';
      attemptsRemaining?: number;
    };

function cooldown(active: ChallengeRow | null, now: Date): number | null {
  if (!active) return null;
  const until = active.createdAt.getTime() + REISSUE_COOLDOWN_MS;
  return until > now.getTime() ? Math.max(1, Math.ceil((until - now.getTime()) / 1000)) : null;
}

/** Start (or replace) the challenge for this email and org. Returns the plaintext code for the mailer only. */
export async function startChallenge(
  input: { email: string; orgId: string; name: string; affiliation: string },
  store: ChallengeStore = prismaChallengeStore,
  now = new Date(),
): Promise<StartResult> {
  const active = await store.latestActive(input.email, input.orgId, now);
  const wait = cooldown(active, now);
  if (wait) return { ok: false, reason: 'rate_limited', retryAfterSeconds: wait };

  const code = generateCode();
  await store.consumeAllActive(input.email, input.orgId, now);
  await store.create(
    {
      email: input.email,
      organizationId: input.orgId,
      name: input.name,
      affiliation: input.affiliation,
      codeHash: await hashCode(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
    now,
  );
  return { ok: true, code };
}

/** New code for the active challenge, keeping the pending details. No challenge → null (caller still answers generically). */
export async function reissueChallenge(
  input: { email: string; orgId: string },
  store: ChallengeStore = prismaChallengeStore,
  now = new Date(),
): Promise<StartResult | null> {
  const active = await store.latestActive(input.email, input.orgId, now);
  if (!active) return null;
  return startChallenge(
    { email: input.email, orgId: input.orgId, name: active.name, affiliation: active.affiliation },
    store,
    now,
  );
}

export async function checkChallenge(
  input: { email: string; orgId: string; code: string },
  store: ChallengeStore = prismaChallengeStore,
  now = new Date(),
): Promise<CheckResult> {
  const active = await store.latestActive(input.email, input.orgId, now);
  if (!active) return { ok: false, reason: 'no_active_code' };

  if (/^\d{6}$/.test(input.code.trim()) && (await verifyCode(input.code.trim(), active.codeHash))) {
    // Single use even under concurrent submits: only one caller can consume it.
    if (!(await store.consume(active.id, now))) return { ok: false, reason: 'no_active_code' };
    return { ok: true, name: active.name, affiliation: active.affiliation };
  }

  const attempts = active.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  await store.update(active.id, { attempts, ...(exhausted ? { consumedAt: now } : {}) });
  return exhausted
    ? { ok: false, reason: 'too_many_attempts' }
    : { ok: false, reason: 'wrong_code', attemptsRemaining: MAX_ATTEMPTS - attempts };
}
