import { requireAdmin } from '@/lib/auth/requireAdmin';
import AdminShell from '../AdminShell';
import PromptsClient from './PromptsClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminPromptsPage() {
  const { admin } = await requireAdmin();

  return (
    <AdminShell
      title="Prompts"
      adminName={admin.name}
      adminRole={admin.role}
    >
      <PromptsClient />
    </AdminShell>
  );
}
