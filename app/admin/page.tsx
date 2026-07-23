import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import LogoutButton from './LogoutButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAV_STUBS = [
  {
    title: 'Prompts',
    description: 'Edit base, guidelines, and guardrails (versioned PromptVersion).',
    href: '/admin/prompts',
  },
  {
    title: 'Transcripts',
    description: 'Browse user conversations and replies.',
    href: '/admin/transcripts',
  },
  {
    title: 'Usage',
    description: 'Per-org daily message counts and token spend.',
    href: '/admin/usage',
  },
  {
    title: 'Organizations',
    description: 'Create orgs, manage limits, re-share credentials.',
    href: '/admin/orgs',
  },
  {
    title: 'Cases',
    description:
      'Edit case study data (table). Layer 3 index regenerates from titles + tech — never edit the index text directly.',
    href: '/admin/cases',
  },
  {
    title: 'Case assets',
    description: 'Upload one-pagers, decks, narratives, demo links.',
    href: '/admin/assets',
  },
  {
    title: 'Knowledge',
    description:
      'Add company knowledge (text / PDF / DOCX) the agent can retrieve without citation.',
    href: '/admin/knowledge',
  },
];

export default async function AdminDashboardPage() {
  const { admin } = await requireAdmin();

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Backstage chrome — deliberately not the client-facing dark theme */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Paramount Intelligence · Backstage
            </p>
            <h1 className="m-0 mt-0.5 text-lg font-semibold text-slate-900">
              Adviser admin
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">
              {admin.name}
              <span className="ml-2 inline-block text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                {admin.role}
              </span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <p className="m-0 mb-6 text-sm text-slate-500">
          Portal shell — sections below come in the next slices.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {NAV_STUBS.map((s) => {
            const card = (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="m-0 text-base font-semibold text-slate-900">
                    {s.title}
                  </h2>
                  {'href' in s && s.href ? (
                    <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      Open →
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="m-0 mt-1.5 text-sm text-slate-500">{s.description}</p>
              </>
            );

            return 'href' in s && s.href ? (
              <Link
                key={s.title}
                href={s.href}
                className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-5 no-underline hover:border-slate-300 hover:shadow transition-all"
              >
                {card}
              </Link>
            ) : (
              <div
                key={s.title}
                className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-5"
              >
                {card}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
