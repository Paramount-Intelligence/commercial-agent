import { requireAdmin } from '@/lib/auth/requireAdmin';
import AdminShell from '../AdminShell';
import CasesClient from './CasesClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminCasesPage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell
      title="Cases"
      adminName={admin.name}
      adminRole={admin.role}
      wide
    >
      <CasesClient />
    </AdminShell>
  );
}
