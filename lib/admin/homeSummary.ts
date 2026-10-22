import { prisma } from '@/lib/db';
import { estimateTotalCostUsd } from '@/lib/gating/costRates';
import { utcToday } from '@/lib/gating/orgLimit';

/**
 * Lightweight home KPIs for /admin dashboard (server-rendered).
 */
export async function loadAdminHomeSummary() {
  const today = new Date(`${utcToday()}T00:00:00.000Z`);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    orgsActive,
    messagesToday,
    usageToday,
    orgs,
    conversations24h,
    fallbackHits24h,
  ] = await Promise.all([
    prisma.organization.count({ where: { active: true } }),
    prisma.message.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.orgUsageDay.findMany({
      where: { day: today },
      select: {
        organizationId: true,
        messageCount: true,
        llmTokens: true,
        ttsChars: true,
        sttSeconds: true,
      },
    }),
    prisma.organization.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        dailyMsgLimit: true,
        dailyLlmTokenLimit: true,
        dailyTtsCharLimit: true,
        dailySttSecondLimit: true,
      },
    }),
    prisma.conversation.count({
      where: { createdAt: { gte: dayAgo } },
    }),
    prisma.message.count({
      where: {
        role: 'assistant',
        createdAt: { gte: dayAgo },
        usedFallback: true,
      },
    }),
  ]);

  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const nearCap: Array<{ name: string; kind: string; percent: number }> = [];
  for (const row of usageToday) {
    const o = orgById.get(row.organizationId);
    if (!o) continue;
    const checks: Array<[number, number, string]> = [
      [row.messageCount, o.dailyMsgLimit, 'messages'],
      [row.llmTokens, o.dailyLlmTokenLimit, 'Claude tokens'],
      [row.ttsChars, o.dailyTtsCharLimit, 'TTS chars'],
      [row.sttSeconds, o.dailySttSecondLimit, 'STT seconds'],
    ];
    for (const [used, limit, kind] of checks) {
      if (limit <= 0) continue;
      const percent = Math.round((used / limit) * 100);
      if (percent >= 80) {
        nearCap.push({ name: o.name, kind, percent });
      }
    }
  }
  nearCap.sort((a, b) => b.percent - a.percent);

  const tokensToday = usageToday.reduce((s, r) => s + r.llmTokens, 0);
  const ttsToday = usageToday.reduce((s, r) => s + r.ttsChars, 0);
  const sttToday = usageToday.reduce((s, r) => s + r.sttSeconds, 0);
  // Rough: treat llm tokens as 85% in / 15% out for estimate (same as docs).
  const estIn = Math.round(tokensToday * 0.85);
  const estOut = tokensToday - estIn;
  const estimatedCostUsd = estimateTotalCostUsd(
    estIn,
    estOut,
    ttsToday,
    sttToday,
  );

  return {
    orgsActive,
    messagesToday,
    conversations24h,
    fallbackHits24h,
    estimatedCostUsdToday: estimatedCostUsd,
    nearCap: nearCap.slice(0, 6),
    fallbackSample: 'Tracked by Message.usedFallback',
  };
}
