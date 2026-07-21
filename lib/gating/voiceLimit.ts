/** Atomic per-org daily voice ceilings (UTC calendar day). */
import cuid from 'cuid';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { utcToday } from './orgLimit';

export const DEFAULT_DAILY_TTS_CHAR_LIMIT = 150_000;
export const DEFAULT_DAILY_STT_SECOND_LIMIT = 3_600;

export type VoiceQuotaResult = {
  allowed: boolean;
  used: number;
  limit: number;
  reserved: number;
};

function todayAsDate(): Date {
  return new Date(`${utcToday()}T00:00:00.000Z`);
}

async function currentUsage(
  organizationId: string,
  field: 'ttsChars' | 'sttSeconds',
): Promise<number> {
  const row = await prisma.orgUsageDay.findUnique({
    where: {
      day_organizationId: { day: todayAsDate(), organizationId },
    },
    select: { ttsChars: true, sttSeconds: true },
  });
  return row?.[field] ?? 0;
}

/** Atomically reserve characters before calling ElevenLabs TTS. */
export async function reserveTtsChars(
  organizationId: string,
  chars: number,
  limit: number,
): Promise<VoiceQuotaResult> {
  const amount = Math.max(0, Math.ceil(chars));
  if (amount <= 0 || limit <= 0 || amount > limit) {
    return {
      allowed: amount === 0 && limit > 0,
      used: await currentUsage(organizationId, 'ttsChars'),
      limit,
      reserved: 0,
    };
  }

  const rows = await prisma.$queryRaw<Array<{ ttsChars: number }>>(Prisma.sql`
    INSERT INTO "OrgUsageDay"
      ("id", "day", "organizationId", "messageCount", "llmTokens", "ttsChars", "sttSeconds")
    VALUES
      (${cuid()}, ${utcToday()}::date, ${organizationId}, 0, 0, ${amount}, 0)
    ON CONFLICT ("day", "organizationId")
    DO UPDATE SET "ttsChars" = "OrgUsageDay"."ttsChars" + ${amount}
    WHERE "OrgUsageDay"."ttsChars" + ${amount} <= ${limit}
    RETURNING "ttsChars"
  `);
  if (rows.length) {
    return { allowed: true, used: rows[0].ttsChars, limit, reserved: amount };
  }
  return {
    allowed: false,
    used: await currentUsage(organizationId, 'ttsChars'),
    limit,
    reserved: 0,
  };
}

/** Atomically reserve estimated seconds before calling ElevenLabs STT. */
export async function reserveSttSeconds(
  organizationId: string,
  seconds: number,
  limit: number,
): Promise<VoiceQuotaResult> {
  const amount = Math.max(1, Math.ceil(seconds));
  if (limit <= 0 || amount > limit) {
    return {
      allowed: false,
      used: await currentUsage(organizationId, 'sttSeconds'),
      limit,
      reserved: 0,
    };
  }

  const rows = await prisma.$queryRaw<Array<{ sttSeconds: number }>>(Prisma.sql`
    INSERT INTO "OrgUsageDay"
      ("id", "day", "organizationId", "messageCount", "llmTokens", "ttsChars", "sttSeconds")
    VALUES
      (${cuid()}, ${utcToday()}::date, ${organizationId}, 0, 0, 0, ${amount})
    ON CONFLICT ("day", "organizationId")
    DO UPDATE SET "sttSeconds" = "OrgUsageDay"."sttSeconds" + ${amount}
    WHERE "OrgUsageDay"."sttSeconds" + ${amount} <= ${limit}
    RETURNING "sttSeconds"
  `);
  if (rows.length) {
    return { allowed: true, used: rows[0].sttSeconds, limit, reserved: amount };
  }
  return {
    allowed: false,
    used: await currentUsage(organizationId, 'sttSeconds'),
    limit,
    reserved: 0,
  };
}

export async function releaseTtsChars(
  organizationId: string,
  chars: number,
): Promise<void> {
  const amount = Math.max(0, Math.ceil(chars));
  if (!amount) return;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "OrgUsageDay"
    SET "ttsChars" = GREATEST(0, "ttsChars" - ${amount})
    WHERE "day" = ${utcToday()}::date AND "organizationId" = ${organizationId}
  `);
}

export async function releaseSttSeconds(
  organizationId: string,
  seconds: number,
): Promise<void> {
  const amount = Math.max(0, Math.ceil(seconds));
  if (!amount) return;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "OrgUsageDay"
    SET "sttSeconds" = GREATEST(0, "sttSeconds" - ${amount})
    WHERE "day" = ${utcToday()}::date AND "organizationId" = ${organizationId}
  `);
}

/**
 * Reconcile the conservative pre-reservation to provider-reported duration.
 * A positive delta is charged truthfully even if another concurrent request
 * consumed the remaining allowance after this request had already been sent.
 */
export async function reconcileSttReservation(
  organizationId: string,
  reservedSeconds: number,
  actualSeconds: number,
  limit: number,
): Promise<void> {
  const reserved = Math.max(0, Math.ceil(reservedSeconds));
  const actual = Math.max(0, Math.ceil(actualSeconds));
  if (reserved > actual) {
    await releaseSttSeconds(organizationId, reserved - actual);
    return;
  }
  if (actual <= reserved) return;

  const delta = actual - reserved;
  const extra = await reserveSttSeconds(organizationId, delta, limit);
  if (extra.allowed) return;

  await prisma.orgUsageDay.updateMany({
    where: { day: todayAsDate(), organizationId },
    data: { sttSeconds: { increment: delta } },
  });
}
