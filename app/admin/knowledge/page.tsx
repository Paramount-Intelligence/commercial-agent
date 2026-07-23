import { requireAdmin } from '@/lib/auth/requireAdmin';
import KnowledgeClient from './KnowledgeClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminKnowledgePage() {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Paramount Intelligence · Backstage
            </p>
            <h1 className="m-0 mt-0.5 text-lg font-semibold text-slate-900">
              Knowledge base
            </h1>
          </div>
          <a
            href="/admin"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 no-underline"
          >
            ← Dashboard
          </a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <KnowledgeClient />
      </main>
    </div>
  );
}
