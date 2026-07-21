import { redirect } from 'next/navigation';
import { readAdminSession } from '@/lib/auth/adminSession';
import AdminLoginForm from './AdminLoginForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  // Already backstage → straight to the dashboard
  const auth = await readAdminSession();
  if (auth) redirect('/admin');

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-100">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Paramount Intelligence · Backstage
          </p>
          <h1 className="m-0 mt-1 text-xl font-semibold text-slate-900">
            Adviser admin
          </h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Restricted — adviser-portal administrators only.
          </p>
        </div>
        <AdminLoginForm />
      </div>
    </div>
  );
}
