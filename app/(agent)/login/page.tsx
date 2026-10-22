import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth/session';
import EnterFlow from './EnterFlow';
import { assistantName } from '@/lib/agent/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Inverted gate: an already-authenticated user goes straight to text chat. */
export default async function LoginPage() {
  const auth = await readSession();
  if (auth) redirect('/chat');
  return (
    <div className="phase5-login min-h-screen">
      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <EnterFlow assistantName={assistantName()} />
      </main>
    </div>
  );
}
