import { redirect } from 'next/navigation';
import { AgentHeader } from '@/components/AgentShell';
import { readSession } from '@/lib/auth/session';
import EnterFlow from './EnterFlow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Inverted gate: an already-authenticated user goes straight to voice. */
export default async function LoginPage() {
  const auth = await readSession();
  if (auth) redirect('/voice');
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background:
          'radial-gradient(ellipse at 20% 50%, rgba(30, 111, 217, 0.18) 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, rgba(27, 58, 107, 0.28) 0%, transparent 50%), linear-gradient(160deg, #060d1a 0%, #0d1f3c 50%, #060d1a 100%)',
      }}
    >
      <AgentHeader />
      <main className="flex-1 flex items-center justify-center px-4 pt-20">
        <EnterFlow />
      </main>
    </div>
  );
}
