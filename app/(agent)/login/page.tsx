import { redirect } from 'next/navigation';
import { AgentHeader } from '@/components/AgentShell';
import { readSession } from '@/lib/auth/session';
import ChatVideoBackground from '../chat/ChatVideoBackground';
import EnterFlow from './EnterFlow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Inverted gate: an already-authenticated user goes straight to text chat. */
export default async function LoginPage() {
  const auth = await readSession();
  if (auth) redirect('/chat');
  return (
    <div
      className="relative isolate min-h-screen flex flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at 20% 50%, rgba(30, 111, 217, 0.18) 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, rgba(27, 58, 107, 0.28) 0%, transparent 50%), linear-gradient(160deg, #060d1a 0%, #0d1f3c 50%, #060d1a 100%)',
      }}
    >
      <ChatVideoBackground />
      <AgentHeader />
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pt-20">
        <EnterFlow />
      </main>
    </div>
  );
}
