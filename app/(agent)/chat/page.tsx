import { redirect } from 'next/navigation';
import {
  isDatabaseUnavailableError,
  readSession,
} from '@/lib/auth/session';
import ServiceUnavailable from '@/components/ServiceUnavailable';
import ChatClient from './ChatClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server gate: no valid 24h session → back to the entry flow. */
export default async function ChatPage() {
  let auth;
  try {
    auth = await readSession();
  } catch (err) {
    if (isDatabaseUnavailableError(err)) {
      return (
        <ServiceUnavailable
          detail="We could not reach the database just now. Wait a few seconds and refresh, your session should still be valid."
        />
      );
    }
    throw err;
  }
  if (!auth) redirect('/login');

  return (
    <ChatClient user={{ id: auth.agentUser.id, name: auth.agentUser.name }} />
  );
}
