/**
 * POST /api/voice/tts — speak already-validated agent text as streaming MP3.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUFFER-AND-GATE BOUNDARY (critical):
 *   This endpoint is the MOUTH, not the brain. It synthesizes audio for text
 *   it is GIVEN. Callers (chat listen button / future voice loop) MUST only
 *   pass text that already passed the agent's citation validator and was
 *   shown to the user. This route does NOT generate replies and does NOT
 *   re-validate content — it voices already-safe text.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Session-gated exactly like /api/chat. Meters ttsChars on OrgUsageDay (+ Message
 * when messageId is provided and owned by the session user).
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { cleanVoiceText } from '@/lib/citationText';
import { prisma } from '@/lib/db';
import { releaseTtsChars, reserveTtsChars } from '@/lib/gating/voiceLimit';
import { VOICE_CONFIG } from '@/lib/voice/config';
import { synthesizeSpeech } from '@/lib/voice/elevenlabs';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Strip citation tags + light markdown so TTS doesn't speak markup. */
function textForSpeech(raw: string): string {
  return cleanVoiceText(raw);
}

export async function POST(req: Request) {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { text?: string; messageId?: string };
    try {
      body = (await req.json()) as { text?: string; messageId?: string };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawText = typeof body.text === 'string' ? body.text : '';
    const spoken = textForSpeech(rawText);
    if (!spoken) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (spoken.length > VOICE_CONFIG.MAX_CHARS_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `Text exceeds ${VOICE_CONFIG.MAX_CHARS_PER_REQUEST} character TTS limit`,
        },
        { status: 400 },
      );
    }

    const messageId =
      typeof body.messageId === 'string' ? body.messageId.trim() : '';

    // Optional: bind metering to a Message the session user owns
    if (messageId) {
      const msg = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          role: true,
          conversation: { select: { userId: true } },
        },
      });
      if (
        !msg ||
        msg.conversation.userId !== auth.agentUser.id ||
        msg.role !== 'assistant'
      ) {
        return NextResponse.json(
          { error: 'messageId not found for this session' },
          { status: 404 },
        );
      }
    }

    const voiceQuota = await reserveTtsChars(
      auth.organization.id,
      spoken.length,
      auth.organization.dailyTtsCharLimit,
    );
    if (!voiceQuota.allowed) {
      return NextResponse.json({
        voiceLimitReached: true,
        modality: 'tts',
        used: voiceQuota.used,
        limit: voiceQuota.limit,
        notice:
          "We've reached today's voice limit for your organization — I can keep helping here in text.",
      });
    }

    let synthesis: Awaited<ReturnType<typeof synthesizeSpeech>>;
    try {
      synthesis = await synthesizeSpeech(spoken);
    } catch (error) {
      await releaseTtsChars(
        auth.organization.id,
        voiceQuota.reserved,
      ).catch((releaseError) => {
        console.error('[api/voice/tts] reservation release failed', releaseError);
      });
      throw error;
    }
    const { stream, chars } = synthesis;

    // OrgUsageDay was reserved atomically before synthesis. Bind accepted
    // audio to the Message for transcript-level usage visibility.
    try {
      if (messageId) {
        await prisma.message.update({
          where: { id: messageId },
          data: { ttsChars: { increment: chars } },
        });
      }
    } catch (meterErr) {
      console.error('[api/voice/tts] metering failed', meterErr);
      // Still return audio — metering must not block playback
    }

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-TTS-Chars': String(chars),
      },
    });
  } catch (err) {
    console.error('[api/voice/tts] unhandled', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = /ELEVENLABS_API_KEY/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
