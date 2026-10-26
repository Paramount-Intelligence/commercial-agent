import { redirect } from 'next/navigation';
import {
  isDatabaseUnavailableError,
  readSession,
} from '@/lib/auth/session';
import ServiceUnavailable from '@/components/ServiceUnavailable';
import VoiceConversation from './VoiceConversation';
import { timingDebugAllowed } from '@/lib/debug/timingDebug';
import { assistantName } from '@/lib/agent/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same airtight session gate as /chat. */
export default async function VoicePage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  let auth;
  try {
    auth = await readSession();
  } catch (err) {
    if (isDatabaseUnavailableError(err)) {
      return (
        <ServiceUnavailable detail="We could not reach the database just now (often after a slow voice transcription). Wait a few seconds and refresh, your session should still be valid." />
      );
    }
    throw err;
  }
  if (!auth) redirect('/login');
  const { conversationId } = await searchParams;

  return (
    <VoiceConversation
      user={{ name: auth.agentUser.name }}
      assistantName={assistantName()}
      debugAllowed={await timingDebugAllowed()}
      initialConversationId={conversationId}
    />
  );
}
