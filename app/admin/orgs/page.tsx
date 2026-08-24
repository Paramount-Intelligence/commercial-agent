import { requireAdmin } from '@/lib/auth/requireAdmin';
import AdminShell from '../AdminShell';
import OrgsClient from './OrgsClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminOrgsPage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell
      title="Organizations"
      adminName={admin.name}
      adminRole={admin.role}
    >
      <OrgsClient />
    </AdminShell>
  );
}
