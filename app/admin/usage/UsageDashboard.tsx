'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type TodayOrg = {
  organizationId: string;
  name: string;
  messagesUsed: number;
  dailyMsgLimit: number;
  percent: number;
  tokensToday: number;
  dailyLlmTokenLimit: number;
  tokenPercent: number;
  ttsCharsToday?: number;
  dailyTtsCharLimit: number;
  ttsPercent: number;
  sttSecondsToday?: number;
  dailySttSecondLimit: number;
  sttPercent: number;
};

type DailyTotal = {
  day: string;
  totalMessages: number;
  totalTokens: number;
  totalTtsChars?: number;
};

type PerOrgTotal = {
  organizationId: string;
  orgName: string;
  messages: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  ttsChars?: number;
  estimatedCostUsd: number;
  estimatedLlmCostUsd?: number;
  estimatedTtsCostUsd?: number;
  sttSeconds?: number;
  estimatedSttCostUsd?: number;
};

type UsagePayload = {
  range: { days: number; start: string; end: string };
  rates: {
    INPUT_RATE_PER_M: number;
    OUTPUT_RATE_PER_M: number;
    EMBEDDING_RATE_PER_M: number;
    ELEVENLABS_RATE_PER_1K_CHARS?: number;
    ELEVENLABS_STT_RATE_PER_HOUR?: number;
  };
  headline: {
    totalMessages: number;
    totalTokens: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalTtsChars?: number;
    totalSttSeconds?: number;
    estimatedCostUsd: number;
    estimatedLlmCostUsd?: number;
    estimatedTtsCostUsd?: number;
    activeOrgs: number;
    activeUsers: number;
  };
  todayPerOrg: TodayOrg[];
  dailyTotals: DailyTotal[];
  perOrgTotals: PerOrgTotal[];
};

function fmtUsd(n: number): string {
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function capBarColor(percent: number): string {
  if (percent >= 100) return 'bg-red-500';
  if (percent >= 80) return 'bg-amber-500';
  return 'bg-slate-700';
}

function CapBadge({ percent }: { percent: number }) {
  if (percent >= 100) {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-700">
        At cap
      </span>
    );
  }
  if (percent >= 80) {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-800">
        Near cap
      </span>
    );
  }
  return null;
}

function CapRow({
  label,
  used,
  limit,
  percent,
  suffix = '',
}: {
  label: string;
  used: number;
  limit: number;
  percent: number;
  suffix?: string;
}) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-600">{label}</span>
          <CapBadge percent={percent} />
        </div>
        <span className="text-[11px] tabular-nums text-slate-500">
          {fmtNum(used)} / {fmtNum(limit)}
          {suffix} ({percent}%)
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${capBarColor(percent)}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

export default function UsageDashboard() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usage?days=${days}`);
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const json = (await res.json()) as UsagePayload & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to load usage');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxDailyMsgs = data
    ? Math.max(1, ...data.dailyTotals.map((d) => d.totalMessages))
    : 1;

  return (
    <div className="flex flex-col gap-6">
      {/* Range selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-slate-500">
          Today&apos;s caps from OrgUsageDay · range volume &amp; cost from Message
          rows
        </p>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white overflow-hidden">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3.5 py-2 text-sm font-medium border-0 cursor-pointer transition-colors ${
                days === d
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Last {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p
          className="m-0 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading usage…
        </div>
      ) : data ? (
        <>
          {/* Headline cards */}
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
            {[
              { label: 'Messages', value: fmtNum(data.headline.totalMessages) },
              { label: 'Tokens', value: fmtNum(data.headline.totalTokens) },
              {
                label: 'TTS chars',
                value: fmtNum(data.headline.totalTtsChars ?? 0),
              },
              {
                label: 'STT seconds',
                value: fmtNum(data.headline.totalSttSeconds ?? 0),
              },
              {
                label: 'Est. cost',
                value: fmtUsd(data.headline.estimatedCostUsd),
                hint: 'estimated',
              },
              { label: 'Active orgs', value: fmtNum(data.headline.activeOrgs) },
              { label: 'Active users', value: fmtNum(data.headline.activeUsers) },
            ].map((c) => (
              <div
                key={c.label}
                className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-4"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {c.label}
                  {c.hint && (
                    <span className="ml-1.5 font-medium normal-case tracking-normal text-slate-400">
                      ({c.hint})
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          <p className="m-0 -mt-3 text-[11px] text-slate-400">
            Cost rates: ${data.rates.INPUT_RATE_PER_M}/MTok in · $
            {data.rates.OUTPUT_RATE_PER_M}/MTok out (Sonnet)
            {data.rates.ELEVENLABS_RATE_PER_1K_CHARS != null
              ? ` · $${data.rates.ELEVENLABS_RATE_PER_1K_CHARS}/1K TTS chars (ElevenLabs)`
              : ''}
            {data.rates.ELEVENLABS_STT_RATE_PER_HOUR != null
              ? ` · $${data.rates.ELEVENLABS_STT_RATE_PER_HOUR}/hr STT (Scribe)`
              : ''}
            . Projection only — not billed truth. Range {data.range.start} →{' '}
            {data.range.end} (UTC).
          </p>

          {/* Today — org caps */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="m-0 text-base font-semibold text-slate-900">
                Today — organizations vs daily limit
              </h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">
                UTC day · amber ≥80% · red at cap
              </p>
            </div>
            {data.todayPerOrg.length === 0 ? (
              <p className="m-0 px-5 py-8 text-sm text-slate-500">
                No active organizations.
              </p>
            ) : (
              <ul className="m-0 p-0 list-none divide-y divide-slate-100">
                {data.todayPerOrg.map((org) => (
                  <li key={org.organizationId} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-900">
                        {org.name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {fmtNum(org.tokensToday)} tokens today
                      </span>
                    </div>
                    <CapRow
                      label="Messages"
                      used={org.messagesUsed}
                      limit={org.dailyMsgLimit}
                      percent={org.percent}
                    />
                    <CapRow
                      label="Claude tokens"
                      used={org.tokensToday}
                      limit={org.dailyLlmTokenLimit}
                      percent={org.tokenPercent}
                    />
                    <CapRow
                      label="TTS characters"
                      used={org.ttsCharsToday ?? 0}
                      limit={org.dailyTtsCharLimit}
                      percent={org.ttsPercent}
                    />
                    <CapRow
                      label="STT seconds"
                      used={org.sttSecondsToday ?? 0}
                      limit={org.dailySttSecondLimit}
                      percent={org.sttPercent}
                      suffix="s"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Daily trend — CSS bars */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
            <h2 className="m-0 text-base font-semibold text-slate-900">
              Daily messages
            </h2>
            <p className="m-0 mt-0.5 mb-4 text-sm text-slate-500">
              Messages per UTC day over the selected range
            </p>
            <div className="flex items-end gap-0.5 h-28">
              {data.dailyTotals.map((d) => {
                const h = Math.max(
                  2,
                  Math.round((d.totalMessages / maxDailyMsgs) * 100),
                );
                return (
                  <div
                    key={d.day}
                    className="flex-1 flex flex-col items-center justify-end h-full min-w-0 group relative"
                    title={`${d.day}: ${d.totalMessages} msgs · ${fmtNum(d.totalTokens)} tok`}
                  >
                    <div
                      className="w-full max-w-[14px] mx-auto rounded-t bg-slate-700 group-hover:bg-slate-900 transition-colors"
                      style={{ height: `${h}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate-400">
              <span>{data.dailyTotals[0]?.day}</span>
              <span>{data.dailyTotals[data.dailyTotals.length - 1]?.day}</span>
            </div>
          </section>

          {/* Per-org table */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="m-0 text-base font-semibold text-slate-900">
                Per-organization ({data.range.days}d)
              </h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">
                Estimated cost = LLM tokens + TTS chars — not billed truth
              </p>
            </div>
            {data.perOrgTotals.length === 0 ? (
              <p className="m-0 px-5 py-8 text-sm text-slate-500">
                No usage in this range.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3 font-medium">Organization</th>
                      <th className="px-4 py-3 font-medium text-right">Messages</th>
                      <th className="px-4 py-3 font-medium text-right">Tokens</th>
                      <th className="px-4 py-3 font-medium text-right">TTS chars</th>
                      <th className="px-4 py-3 font-medium text-right">STT sec</th>
                      <th className="px-4 py-3 font-medium text-right">
                        Est. cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.perOrgTotals.map((r) => (
                      <tr key={r.organizationId}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {r.orgName}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {fmtNum(r.messages)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {fmtNum(r.tokens)}
                          <span className="block text-[10px] text-slate-400">
                            {fmtNum(r.tokensIn)} in / {fmtNum(r.tokensOut)} out
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {fmtNum(r.ttsChars ?? 0)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {fmtNum(r.sttSeconds ?? 0)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {fmtUsd(r.estimatedCostUsd)}
                          <span className="block text-[10px] text-slate-400">
                            estimated
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {loading && (
            <p className="m-0 text-xs text-slate-400 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Refreshing…
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
