import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth/session';
import VoiceConversation from './VoiceConversation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same airtight session gate as /chat. */
export default async function VoicePage() {
  const auth = await readSession();
  if (!auth) redirect('/login');

  return <VoiceConversation user={{ name: auth.agentUser.name }} />;
}
