import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth/session';
import ChatClient from './ChatClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server gate: no valid 24h session → back to the entry flow. */
export default async function ChatPage() {
  const auth = await readSession();
  if (!auth) redirect('/login');

  return (
    <ChatClient user={{ id: auth.agentUser.id, name: auth.agentUser.name }} />
  );
}
