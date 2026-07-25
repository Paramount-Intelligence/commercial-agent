/**
 * Per-org daily message cap over OrgUsageDay (day = UTC date).
 * Reset is automatic: a new UTC day means a new (day, org) row starting at 0.
 */
import cuid from 'cuid';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';

export type QuotaResult = {
  allowed: boolean;
  used: number;
  limit: number;
};

/** Today as a UTC calendar date, 'YYYY-MM-DD' (matches DATE column semantics). */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcTodayAsDate(): Date {
  return new Date(`${utcToday()}T00:00:00.000Z`);
}

/**
 * Atomic check-and-reserve: ONE statement both checks the cap and increments,
 * so two concurrent requests can never both slip past the limit.
 *
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE messageCount < limit RETURNING:
 * - no row for (day, org) yet → inserts with messageCount = 1 (this message)
 * - row exists and under limit → increments, returns the new count
 * - row exists at/over limit → the WHERE fails, nothing returned → denied
 */
export type CombinedQuotaResult =
  | { allowed: true; used: number; limit: number }
  | {
      allowed: false;
      deniedBy: 'messages' | 'llmTokens';
      used: number;
      limit: number;
    };

/**
 * Both daily caps in ONE statement, replacing a token read followed by a
 * separate reserve. Denial semantics are unchanged: the ON CONFLICT WHERE
 * covers both ceilings, so a request denied for either reason increments
 * nothing. The extra read below runs only on the (rare) denial path, to
 * report which cap was hit.
 */
export async function reserveTurnQuota(
  organizationId: string,
  dailyMsgLimit: number,
  dailyLlmTokenLimit: number,
): Promise<CombinedQuotaResult> {
  if (dailyMsgLimit <= 0) {
    return { allowed: false, deniedBy: 'messages', used: 0, limit: dailyMsgLimit };
  }
  if (dailyLlmTokenLimit <= 0) {
    return {
      allowed: false,
      deniedBy: 'llmTokens',
      used: 0,
      limit: dailyLlmTokenLimit,
    };
  }

  const rows = await prisma.$queryRaw<Array<{ messageCount: number }>>(Prisma.sql`
    INSERT INTO "OrgUsageDay" ("id", "day", "organizationId", "messageCount")
    VALUES (${cuid()}, ${utcToday()}::date, ${organizationId}, 1)
    ON CONFLICT ("day", "organizationId")
    DO UPDATE SET "messageCount" = "OrgUsageDay"."messageCount" + 1
    WHERE "OrgUsageDay"."messageCount" < ${dailyMsgLimit}
      AND "OrgUsageDay"."llmTokens" < ${dailyLlmTokenLimit}
    RETURNING "messageCount"
  `);

  if (rows.length > 0) {
    return { allowed: true, used: rows[0].messageCount, limit: dailyMsgLimit };
  }

  const row = await prisma.orgUsageDay.findUnique({
    where: {
      day_organizationId: { day: utcTodayAsDate(), organizationId },
    },
    select: { messageCount: true, llmTokens: true },
  });
  // Tokens are checked first to match the previous ordering, where the token
  // gate ran before the message reserve.
  if ((row?.llmTokens ?? 0) >= dailyLlmTokenLimit) {
    return {
      allowed: false,
      deniedBy: 'llmTokens',
      used: row?.llmTokens ?? dailyLlmTokenLimit,
      limit: dailyLlmTokenLimit,
    };
  }
  return {
    allowed: false,
    deniedBy: 'messages',
    used: row?.messageCount ?? dailyMsgLimit,
    limit: dailyMsgLimit,
  };
}

/**
 * Token accounting for the cost dashboard (additive, best-effort — callers
 * should not fail the request if this throws). The reserve above guarantees
 * today's row exists, so updateMany hits it.
 */
export async function recordOrgTokens(
  organizationId: string,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  await prisma.orgUsageDay.updateMany({
    where: { day: utcTodayAsDate(), organizationId },
    data: { llmTokens: { increment: tokens } },
  });
}

/**
 * TTS character metering for OrgUsageDay. Upserts today's row so voice can
 * be metered even if no chat quota row was created yet today.
 */
export async function recordOrgTtsChars(
  organizationId: string,
  chars: number,
): Promise<void> {
  if (chars <= 0) return;
  const day = utcTodayAsDate();
  await prisma.orgUsageDay.upsert({
    where: {
      day_organizationId: { day, organizationId },
    },
    create: {
      id: cuid(),
      day,
      organizationId,
      messageCount: 0,
      llmTokens: 0,
      ttsChars: chars,
      sttSeconds: 0,
    },
    update: {
      ttsChars: { increment: chars },
    },
  });
}

/**
 * STT audio-seconds metering for OrgUsageDay (Scribe is billed by duration).
 */
export async function recordOrgSttSeconds(
  organizationId: string,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;
  const day = utcTodayAsDate();
  await prisma.orgUsageDay.upsert({
    where: {
      day_organizationId: { day, organizationId },
    },
    create: {
      id: cuid(),
      day,
      organizationId,
      messageCount: 0,
      llmTokens: 0,
      ttsChars: 0,
      sttSeconds: seconds,
    },
    update: {
      sttSeconds: { increment: seconds },
    },
  });
}
