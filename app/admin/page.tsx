import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { loadAdminHomeSummary } from '@/lib/admin/homeSummary';
import AdminShell from './AdminShell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmtUsd(n: number): string {
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AdminDashboardPage() {
  const { admin } = await requireAdmin();
  const summary = await loadAdminHomeSummary();

  return (
    <AdminShell
      title="Dashboard"
      adminName={admin.name}
      adminRole={admin.role}
    >
      <p className="m-0 mb-6 text-sm text-slate-600">
        Live ops overview for Jackie. Use the sidebar to manage content, orgs,
        and prompts.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Active orgs', value: String(summary.orgsActive) },
          { label: 'Messages today', value: summary.messagesToday.toLocaleString() },
          {
            label: 'Conversations (24h)',
            value: summary.conversations24h.toLocaleString(),
          },
          {
            label: 'Est. voice+LLM $ today',
            value: fmtUsd(summary.estimatedCostUsdToday),
            hint: 'Projection, not invoice',
          },
        ].map((c) => (
          <div
            key={c.label}
            className="bg-white rounded-xl border border-slate-200 px-4 py-3"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {c.label}
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
              {c.value}
            </div>
            {'hint' in c && c.hint ? (
              <div className="mt-0.5 text-[10px] text-slate-400">{c.hint}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold text-slate-900">
              Grounding fallbacks (24h)
            </h2>
            <Link
              href="/admin/transcripts?failures=1"
              className="text-xs font-medium text-slate-600 hover:text-slate-900 no-underline"
            >
              Review →
            </Link>
          </div>
          <p className="m-0 mt-2 text-2xl font-semibold tabular-nums text-slate-900">
            {summary.fallbackHits24h}
          </p>
          <p className="m-0 mt-1 text-xs text-slate-500">
            Assistant replies matching the safe “not on file” handoff (often
            src-gate).
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <h2 className="m-0 text-sm font-semibold text-slate-900">
            Near daily caps (≥80%)
          </h2>
          {summary.nearCap.length === 0 ? (
            <p className="m-0 mt-3 text-sm text-slate-500">
              No orgs near a cap today.
            </p>
          ) : (
            <ul className="m-0 mt-3 p-0 list-none space-y-2">
              {summary.nearCap.map((n) => (
                <li
                  key={`${n.name}-${n.kind}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-slate-800 truncate">
                    {n.name}{' '}
                    <span className="text-slate-500">· {n.kind}</span>
                  </span>
                  <span
                    className={
                      n.percent >= 100
                        ? 'text-red-700 font-semibold tabular-nums'
                        : 'text-amber-700 font-semibold tabular-nums'
                    }
                  >
                    {n.percent}%
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/admin/usage"
            className="inline-block mt-3 text-xs font-medium text-slate-600 hover:text-slate-900 no-underline"
          >
            Open usage →
          </Link>
        </div>
      </div>

      <h2 className="m-0 mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
        Shortcuts
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          {
            title: 'Transcripts',
            description: 'Triage conversations and grounding handoffs.',
            href: '/admin/transcripts',
          },
          {
            title: 'Organizations',
            description: 'Partner credentials and daily voice/LLM caps.',
            href: '/admin/orgs',
          },
          {
            title: 'Cases & assets',
            description: 'Edit case studies and attach one-pagers.',
            href: '/admin/cases',
          },
          {
            title: 'Prompts',
            description: 'Versioned base, guidelines, and guardrails.',
            href: '/admin/prompts',
          },
        ].map((s) => (
          <Link
            key={s.title}
            href={s.href}
            className="bg-white rounded-xl border border-slate-200 px-5 py-4 no-underline hover:border-slate-300 transition-colors"
          >
            <h3 className="m-0 text-base font-semibold text-slate-900">
              {s.title}
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">{s.description}</p>
          </Link>
        ))}
      </div>
    </AdminShell>
  );
}
