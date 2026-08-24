import { requireAdmin } from '@/lib/auth/requireAdmin';
import { Suspense } from 'react';
import AdminShell from '../AdminShell';
import TranscriptsList from './TranscriptsList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminTranscriptsPage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell
      title="Transcripts"
      adminName={admin.name}
      adminRole={admin.role}
    >
      <Suspense
        fallback={
          <p className="m-0 text-sm text-slate-500">Loading transcripts…</p>
        }
      >
        <TranscriptsList />
      </Suspense>
    </AdminShell>
  );
}
