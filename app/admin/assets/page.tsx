import { Suspense } from 'react';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import AdminShell from '../AdminShell';
import AssetsClient from './AssetsClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminAssetsPage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell
      title="Case assets"
      adminName={admin.name}
      adminRole={admin.role}
    >
      <Suspense
        fallback={
          <p className="m-0 text-sm text-slate-500">Loading assets…</p>
        }
      >
        <AssetsClient />
      </Suspense>
    </AdminShell>
  );
}
