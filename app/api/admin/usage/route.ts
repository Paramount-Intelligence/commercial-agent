import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { COST_RATES, estimateCostUsd, estimateTtsCostUsd, estimateSttCostUsd, estimateTotalCostUsd } from '@/lib/gating/costRates';
import { utcToday } from '@/lib/gating/orgLimit';

export const runtime = 'nodejs';

const ALLOWED_RANGES = new Set([7, 30, 90]);

function utcDayStart(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Usage & cost dashboard aggregates (read-only).
 * Query: days=7|30|90 (default 30).
 *
 * OrgUsageDay → TODAY cap panel + STT/TTS day counters.
 * Range analytics (messages/tokens/TTS) → Message rows joined via Conversation
 * → AgentUser (per-org + per-user). STT remains org-only (not stored per user).
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const url = new URL(req.url);
    const daysRaw = Number(url.searchParams.get('days') ?? '30') || 30;
    const days = ALLOWED_RANGES.has(daysRaw) ? daysRaw : 30;

    const todayStr = utcToday();
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
    // Inclusive range: today and the previous (days-1) calendar days
    const rangeStart = utcDayStart(days - 1);

    const activeOrgs = await prisma.organization.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        dailyMsgLimit: true,
        dailyLlmTokenLimit: true,
        dailyTtsCharLimit: true,
        dailySttSecondLimit: true,
      },
      orderBy: { name: 'asc' },
    });
    const orgById = new Map(activeOrgs.map((o) => [o.id, o]));

    // --- 1. TODAY per-org (cap view) — OrgUsageDay ONLY ---
    const todayUsage = await prisma.orgUsageDay.findMany({
      where: {
        day: todayDate,
        organizationId: { in: activeOrgs.map((o) => o.id) },
      },
      select: {
        organizationId: true,
        messageCount: true,
        llmTokens: true,
        ttsChars: true,
        sttSeconds: true,
      },
    });
    const todayByOrg = new Map(
      todayUsage.map((u) => [u.organizationId, u]),
    );

    const todayPerOrg = activeOrgs
      .map((org) => {
        const u = todayByOrg.get(org.id);
        const messagesUsed = u?.messageCount ?? 0;
        const tokensToday = u?.llmTokens ?? 0;
        const ttsCharsToday = u?.ttsChars ?? 0;
        const sttSecondsToday = u?.sttSeconds ?? 0;
        const limit = org.dailyMsgLimit;
        const percent =
          limit > 0 ? Math.min(100, Math.round((messagesUsed / limit) * 1000) / 10) : 0;
        const tokenPercent =
          org.dailyLlmTokenLimit > 0
            ? Math.min(
                100,
                Math.round(
                  (tokensToday / org.dailyLlmTokenLimit) * 1000,
                ) / 10,
              )
            : 0;
        const ttsPercent =
          org.dailyTtsCharLimit > 0
            ? Math.min(
                100,
                Math.round(
                  (ttsCharsToday / org.dailyTtsCharLimit) * 1000,
                ) / 10,
              )
            : 0;
        const sttPercent =
          org.dailySttSecondLimit > 0
            ? Math.min(
                100,
                Math.round(
                  (sttSecondsToday / org.dailySttSecondLimit) * 1000,
                ) / 10,
              )
            : 0;
        return {
          organizationId: org.id,
          name: org.name,
          messagesUsed,
          dailyMsgLimit: limit,
          percent,
          tokensToday,
          dailyLlmTokenLimit: org.dailyLlmTokenLimit,
          tokenPercent,
          ttsCharsToday,
          dailyTtsCharLimit: org.dailyTtsCharLimit,
          ttsPercent,
          sttSecondsToday,
          dailySttSecondLimit: org.dailySttSecondLimit,
          sttPercent,
        };
      })
      .sort(
        (a, b) =>
          Math.max(b.percent, b.tokenPercent, b.ttsPercent, b.sttPercent) -
          Math.max(a.percent, a.tokenPercent, a.ttsPercent, a.sttPercent),
      );

    // --- 2. Range analytics — Message rows (historical truth) ---
    const messagesInRange = await prisma.message.findMany({
      where: {
        createdAt: { gte: rangeStart },
        conversation: {
          user: { organizationId: { not: null } },
        },
      },
      select: {
        tokensIn: true,
        tokensOut: true,
        ttsChars: true,
        createdAt: true,
        conversation: {
          select: {
            userId: true,
            user: { select: { organizationId: true } },
          },
        },
      },
    });

    const dailyMap = new Map<
      string,
      { totalMessages: number; totalTokens: number; totalTtsChars: number }
    >();
    // Seed every day in the range so the chart has no gaps
    for (let i = 0; i < days; i++) {
      const d = new Date(rangeStart);
      d.setUTCDate(rangeStart.getUTCDate() + i);
      dailyMap.set(toDayKey(d), {
        totalMessages: 0,
        totalTokens: 0,
        totalTtsChars: 0,
      });
    }

    type OrgAgg = {
      messages: number;
      tokensIn: number;
      tokensOut: number;
      ttsChars: number;
    };
    type UserAgg = {
      userId: string;
      organizationId: string;
      messages: number;
      tokensIn: number;
      tokensOut: number;
      ttsChars: number;
    };
    const orgAgg = new Map<string, OrgAgg>();
    const userAgg = new Map<string, UserAgg>();
    const activeUserIds = new Set<string>();

    for (const m of messagesInRange) {
      const orgId = m.conversation.user.organizationId;
      if (!orgId) continue;
      const userId = m.conversation.userId;

      const dayKey = toDayKey(m.createdAt);
      const dayBucket = dailyMap.get(dayKey);
      if (dayBucket) {
        dayBucket.totalMessages += 1; // every Message row
        dayBucket.totalTokens += m.tokensIn + m.tokensOut;
        dayBucket.totalTtsChars += m.ttsChars;
      }

      const agg = orgAgg.get(orgId) ?? {
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        ttsChars: 0,
      };
      agg.messages += 1;
      agg.tokensIn += m.tokensIn;
      agg.tokensOut += m.tokensOut;
      agg.ttsChars += m.ttsChars;
      orgAgg.set(orgId, agg);

      const uAgg = userAgg.get(userId) ?? {
        userId,
        organizationId: orgId,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        ttsChars: 0,
      };
      uAgg.messages += 1;
      uAgg.tokensIn += m.tokensIn;
      uAgg.tokensOut += m.tokensOut;
      uAgg.ttsChars += m.ttsChars;
      userAgg.set(userId, uAgg);

      activeUserIds.add(userId);
    }

    const users = await prisma.agentUser.findMany({
      where: { id: { in: [...userAgg.keys()] } },
      select: { id: true, name: true, email: true, organizationId: true },
    });
    const userMeta = new Map(users.map((u) => [u.id, u]));

    type PerUserRow = {
      userId: string;
      name: string | null;
      email: string;
      messages: number;
      tokens: number;
      tokensIn: number;
      tokensOut: number;
      ttsChars: number;
      /** STT is org-metered only today — always null at user grain. */
      sttSeconds: null;
      estimatedCostUsd: number;
      estimatedLlmCostUsd: number;
      estimatedTtsCostUsd: number;
    };

    function usersForOrg(organizationId: string): PerUserRow[] {
      return [...userAgg.values()]
        .filter((u) => u.organizationId === organizationId)
        .map((u) => {
          const meta = userMeta.get(u.userId);
          return {
            userId: u.userId,
            name: meta?.name ?? null,
            email: meta?.email ?? '(unknown)',
            messages: u.messages,
            tokens: u.tokensIn + u.tokensOut,
            tokensIn: u.tokensIn,
            tokensOut: u.tokensOut,
            ttsChars: u.ttsChars,
            sttSeconds: null as null,
            estimatedCostUsd: estimateTotalCostUsd(
              u.tokensIn,
              u.tokensOut,
              u.ttsChars,
              0,
            ),
            estimatedLlmCostUsd: estimateCostUsd(u.tokensIn, u.tokensOut),
            estimatedTtsCostUsd: estimateTtsCostUsd(u.ttsChars),
          };
        })
        .sort(
          (a, b) =>
            b.messages - a.messages ||
            b.tokens - a.tokens ||
            b.ttsChars - a.ttsChars,
        );
    }

    const dailyTotals = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        day,
        totalMessages: v.totalMessages,
        totalTokens: v.totalTokens,
        totalTtsChars: v.totalTtsChars,
      }));

    // STT (and TTS day totals) over the range from OrgUsageDay
    const usageInRange = await prisma.orgUsageDay.findMany({
      where: {
        day: { gte: rangeStart },
        organizationId: { in: [...new Set([...activeOrgs.map((o) => o.id), ...orgAgg.keys()])] },
      },
      select: {
        organizationId: true,
        ttsChars: true,
        sttSeconds: true,
      },
    });
    const voiceByOrg = new Map<string, { ttsChars: number; sttSeconds: number }>();
    for (const row of usageInRange) {
      const cur = voiceByOrg.get(row.organizationId) ?? { ttsChars: 0, sttSeconds: 0 };
      cur.ttsChars += row.ttsChars;
      cur.sttSeconds += row.sttSeconds;
      voiceByOrg.set(row.organizationId, cur);
    }

    const perOrgTotals = activeOrgs
      .map((org) => {
        const agg = orgAgg.get(org.id) ?? {
          messages: 0,
          tokensIn: 0,
          tokensOut: 0,
          ttsChars: 0,
        };
        const voice = voiceByOrg.get(org.id) ?? { ttsChars: 0, sttSeconds: 0 };
        // Prefer Message.ttsChars when present; fall back to OrgUsageDay for voice-only days
        const ttsChars = Math.max(agg.ttsChars, voice.ttsChars);
        const sttSeconds = voice.sttSeconds;
        return {
          organizationId: org.id,
          orgName: org.name,
          messages: agg.messages,
          tokens: agg.tokensIn + agg.tokensOut,
          tokensIn: agg.tokensIn,
          tokensOut: agg.tokensOut,
          ttsChars,
          sttSeconds,
          estimatedCostUsd: estimateTotalCostUsd(
            agg.tokensIn,
            agg.tokensOut,
            ttsChars,
            sttSeconds,
          ),
          estimatedLlmCostUsd: estimateCostUsd(agg.tokensIn, agg.tokensOut),
          estimatedTtsCostUsd: estimateTtsCostUsd(ttsChars),
          estimatedSttCostUsd: estimateSttCostUsd(sttSeconds),
          users: usersForOrg(org.id),
        };
      })
      .filter(
        (r) =>
          r.messages > 0 || r.tokens > 0 || r.ttsChars > 0 || r.sttSeconds > 0,
      );

    // Inactive orgs that still had usage in the range (historical)
    const inactiveOrgIds = [...orgAgg.keys()].filter((id) => !orgById.has(id));
    if (inactiveOrgIds.length > 0) {
      const inactiveOrgs = await prisma.organization.findMany({
        where: { id: { in: inactiveOrgIds } },
        select: { id: true, name: true },
      });
      for (const org of inactiveOrgs) {
        const agg = orgAgg.get(org.id)!;
        const voice = voiceByOrg.get(org.id) ?? { ttsChars: 0, sttSeconds: 0 };
        const ttsChars = Math.max(agg.ttsChars, voice.ttsChars);
        const sttSeconds = voice.sttSeconds;
        perOrgTotals.push({
          organizationId: org.id,
          orgName: `${org.name} (inactive)`,
          messages: agg.messages,
          tokens: agg.tokensIn + agg.tokensOut,
          tokensIn: agg.tokensIn,
          tokensOut: agg.tokensOut,
          ttsChars,
          sttSeconds,
          estimatedCostUsd: estimateTotalCostUsd(
            agg.tokensIn,
            agg.tokensOut,
            ttsChars,
            sttSeconds,
          ),
          estimatedLlmCostUsd: estimateCostUsd(agg.tokensIn, agg.tokensOut),
          estimatedTtsCostUsd: estimateTtsCostUsd(ttsChars),
          estimatedSttCostUsd: estimateSttCostUsd(sttSeconds),
          users: usersForOrg(org.id),
        });
      }
    }
    perOrgTotals.sort((a, b) => b.messages - a.messages || b.tokens - a.tokens);

    const totalMessages = perOrgTotals.reduce((s, r) => s + r.messages, 0);
    const totalTokensIn = perOrgTotals.reduce((s, r) => s + r.tokensIn, 0);
    const totalTokensOut = perOrgTotals.reduce((s, r) => s + r.tokensOut, 0);
    const totalTtsChars = perOrgTotals.reduce((s, r) => s + r.ttsChars, 0);
    const totalSttSeconds = perOrgTotals.reduce((s, r) => s + r.sttSeconds, 0);
    const totalTokens = totalTokensIn + totalTokensOut;
    const estimatedCostUsd = estimateTotalCostUsd(
      totalTokensIn,
      totalTokensOut,
      totalTtsChars,
      totalSttSeconds,
    );

    return NextResponse.json({
      range: {
        days,
        start: toDayKey(rangeStart),
        end: todayStr,
      },
      rates: COST_RATES,
      notes: {
        perUserStt:
          'STT seconds are metered on OrgUsageDay only — not attributable per user yet.',
        perUserTts:
          'Per-user TTS chars come from Message.ttsChars (set when voice TTS passes messageId).',
      },
      headline: {
        totalMessages,
        totalTokens,
        totalTokensIn,
        totalTokensOut,
        totalTtsChars,
        totalSttSeconds,
        estimatedCostUsd,
        estimatedLlmCostUsd: estimateCostUsd(totalTokensIn, totalTokensOut),
        estimatedTtsCostUsd: estimateTtsCostUsd(totalTtsChars),
        estimatedSttCostUsd: estimateSttCostUsd(totalSttSeconds),
        activeOrgs: activeOrgs.length,
        activeUsers: activeUserIds.size,
      },
      todayPerOrg,
      dailyTotals,
      perOrgTotals,
    });
  } catch (err) {
    console.error('[api/admin/usage GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
