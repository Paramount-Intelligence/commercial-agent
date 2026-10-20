/**
 * Sign-in rate limits, shared across serverless instances (Postgres).
 *
 * Fixed windows: one AuthRateLimit row per (hashed key, window start), bumped
 * atomically with INSERT … ON CONFLICT. Window maths uses database time so all
 * instances agree. Keys are SHA-256 of "<rule>|<subject>", so raw IPs and
 * emails are never stored. Every attempt counts, allowed or not.
 */
import { createHash } from 'crypto';
import { prisma } from '../db';

export type LimitRule = { name: string; limit: number; windowSeconds: number };

const MIN = 60;

export const LIMITS = {
  orgLoginIp: { name: 'org-login:ip', limit: 10, windowSeconds: 15 * MIN },
  orgLoginAccount: { name: 'org-login:account', limit: 10, windowSeconds: 15 * MIN },
  identifyIp: { name: 'identify:ip', limit: 20, windowSeconds: 15 * MIN },
  identifyEmail: { name: 'identify:email', limit: 5, windowSeconds: 15 * MIN },
  identifyOrg: { name: 'identify:org', limit: 40, windowSeconds: 60 * MIN },
  verifyIp: { name: 'verify:ip', limit: 20, windowSeconds: 15 * MIN },
  verifyEmail: { name: 'verify:email', limit: 10, windowSeconds: 15 * MIN },
  resendIp: { name: 'resend:ip', limit: 20, windowSeconds: 15 * MIN },
  resendEmail: { name: 'resend:email', limit: 5, windowSeconds: 60 * MIN },
  adminLoginIp: { name: 'admin-login:ip', limit: 10, windowSeconds: 15 * MIN },
  adminLoginAccount: { name: 'admin-login:account', limit: 10, windowSeconds: 15 * MIN },
} satisfies Record<string, LimitRule>;

export type LimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function rateLimitKey(rule: LimitRule, subject: string): string {
  return createHash('sha256').update(`${rule.name}|${subject.trim().toLowerCase()}`).digest('hex');
}

/** First hop of the forwarding headers Vercel sets; "local" when absent. */
export function clientIp(req: Request): string {
  const h = req.headers;
  const raw =
    h.get('x-vercel-forwarded-for') ?? h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '';
  const first = raw.split(',')[0]?.trim();
  return first || 'local';
}

async function hit(rule: LimitRule, subject: string): Promise<LimitResult> {
  const key = rateLimitKey(rule, subject);
  const w = rule.windowSeconds;
  const rows = await prisma.$queryRaw<Array<{ count: number; retry: number }>>`
    INSERT INTO "AuthRateLimit" ("key", "windowStart", "count")
    VALUES (${key}, to_timestamp(floor(extract(epoch from now()) / ${w}) * ${w}), 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "AuthRateLimit"."count" + 1
    RETURNING "count",
      ceil(extract(epoch from ("windowStart" + make_interval(secs => ${w}) - now())))::int AS retry
  `;
  const row = rows[0];
  if (!row || row.count <= rule.limit) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(1, Number(row.retry) || 1) };
}

/**
 * Count one attempt against every rule (null subjects are skipped) and return
 * the strictest refusal. Database errors propagate: callers fail closed.
 */
export async function checkLimits(
  checks: Array<[LimitRule, string | null | undefined]>,
): Promise<LimitResult> {
  let worst: LimitResult = { allowed: true };
  for (const [rule, subject] of checks) {
    if (!subject) continue;
    const r = await hit(rule, subject);
    if (!r.allowed && (worst.allowed || r.retryAfterSeconds > worst.retryAfterSeconds)) worst = r;
  }
  if (Math.random() < 0.02) {
    void prisma.$executeRaw`DELETE FROM "AuthRateLimit" WHERE "windowStart" < now() - interval '1 day'`.catch(() => {});
  }
  return worst;
}

export const RATE_LIMIT_MESSAGE = 'Too many attempts. Please wait a few minutes and try again.';
