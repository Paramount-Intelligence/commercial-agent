import { requireAdmin } from '@/lib/auth/requireAdmin';
import AdminShell from '../AdminShell';
import UsageDashboard from './UsageDashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminUsagePage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell title="Usage" adminName={admin.name} adminRole={admin.role}>
      <UsageDashboard />
    </AdminShell>
  );
}
