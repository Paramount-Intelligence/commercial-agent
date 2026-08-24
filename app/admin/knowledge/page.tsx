import { requireAdmin } from '@/lib/auth/requireAdmin';
import AdminShell from '../AdminShell';
import KnowledgeClient from './KnowledgeClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminKnowledgePage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell
      title="Knowledge"
      adminName={admin.name}
      adminRole={admin.role}
    >
      <KnowledgeClient />
    </AdminShell>
  );
}
