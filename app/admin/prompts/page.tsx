import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import PromptsClient from './PromptsClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminPromptsPage() {
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
              System prompt layers
            </h1>
          </div>
          <Link
            href="/admin"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 no-underline"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <PromptsClient />
      </main>
    </div>
  );
}
