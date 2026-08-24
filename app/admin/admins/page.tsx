import { requireAdmin } from '@/lib/auth/requireAdmin';
import AdminShell from '../AdminShell';
import AdminsClient from './AdminsClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminAdminsPage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell
      title="Admins"
      adminName={admin.name}
      adminRole={admin.role}
    >
      <AdminsClient />
    </AdminShell>
  );
}
