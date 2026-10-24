/**
 * POST /api/voice/tts — speak already-validated agent text as streaming MP3 or PCM.
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
 *
 * Never hangs past the Vercel 60s kill: spoken text is capped and Fish
 * TTFB+streaming body abort at TTS_FETCH_TIMEOUT_MS. The response starts with
 * Fish's first audio bytes instead of buffering the complete response.
 *
 * Provider: Fish Audio (FISH_API_KEY + FISH_VOICE_ID).
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { cleanVoiceText } from '@/lib/citationText';
import { prisma } from '@/lib/db';
import { releaseTtsChars, reserveTtsChars } from '@/lib/gating/voiceLimit';
import { VOICE_CONFIG } from '@/lib/voice/config';
import {
  isTtsBillingError,
  isTtsConfigError,
  isTtsRateLimitError,
  isTtsTimeoutError,
  resolveTtsProvider,
  synthesizeSpeech,
  truncateForTts,
} from '@/lib/voice/tts';
import { notifyJackieFailure } from '@/lib/alerts/failureAlert';
import { startPhaseTimer } from '@/lib/agent/phaseTimer';

export const runtime = 'nodejs';
/**
 * Vercel Hobby / Fluid hard-cap is 60s — values above 60 are ignored there.
 * Finish (or degradeToText) before the platform kill; see fishAudio buffer path.
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Strip citation tags + light markdown so TTS doesn't speak markup. */
function textForSpeech(raw: string): string {
  return cleanVoiceText(raw);
}

export async function POST(req: Request) {
  const routeStartedAt = Date.now();
  // Diagnostic phase timing; returned in the X-Timing-Ms header and logged.
  const timer = startPhaseTimer('api/voice/tts');
  let auth: Awaited<ReturnType<typeof readSession>> = null;
  try {
    const bodyPromise = req.json().catch(() => null) as Promise<{
      text?: string;
      messageId?: string;
      format?: string;
    } | null>;
    auth = await readSession();
    timer.mark('readSession');
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await bodyPromise;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawText = typeof body.text === 'string' ? body.text : '';
    const format = body.format === 'pcm' ? 'pcm' : 'mp3';
    const cleaned = textForSpeech(rawText);
    if (!cleaned) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    // Cap before reserving quota so metering matches what the TTS provider hears.
    const { text: spoken, inputChars, truncated } = truncateForTts(cleaned);
    console.info('[api/voice/tts] request', {
      provider: resolveTtsProvider(),
      rawChars: rawText.length,
      cleanedChars: cleaned.length,
      spokenChars: spoken.length,
      inputChars,
      truncated,
      maxChars: VOICE_CONFIG.MAX_CHARS_PER_REQUEST,
      orgId: auth.organization.id,
    });

    if (!spoken) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    timer.mark('bodyParse');
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

    timer.mark('messageCheck');
    const voiceQuota = await reserveTtsChars(
      auth.organization.id,
      spoken.length,
      auth.organization.dailyTtsCharLimit,
    );
    timer.mark('quotaReserve');
    if (!voiceQuota.allowed) {
      notifyJackieFailure({
        kind: 'quota_tts',
        reason: `Daily TTS char limit reached (${voiceQuota.used}/${voiceQuota.limit})`,
        orgId: auth.organization.id,
        orgName: auth.organization.name,
        route: '/api/voice/tts',
      });
      return NextResponse.json({
        voiceLimitReached: true,
        modality: 'tts',
        used: voiceQuota.used,
        limit: voiceQuota.limit,
        notice:
          "We've reached today's voice limit for your organization, I can keep helping here in text.",
      });
    }

    let synthesis: Awaited<ReturnType<typeof synthesizeSpeech>>;
    try {
      synthesis = await synthesizeSpeech(spoken, {
        signal: req.signal,
        format,
      });
      timer.mark('fishSynthesis');
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
    timer.mark('metering');
    timer.log('request complete', { spokenChars: chars });

    console.info('[api/voice/tts] streaming audio', {
      elapsedMs: Date.now() - routeStartedAt,
      spokenChars: chars,
      truncated: synthesis.truncated,
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': format === 'pcm' ? 'audio/pcm' : 'audio/mpeg',
        ...(format === 'pcm'
          ? { 'X-Audio-Sample-Rate': String(VOICE_CONFIG.PCM_SAMPLE_RATE) }
          : {}),
        'Cache-Control': 'no-store',
        'X-TTS-Chars': String(chars),
        'X-Timing-Ms': JSON.stringify({ ...timer.phases(), total: timer.total() }),
        ...(truncated || synthesis.truncated
          ? { 'X-TTS-Truncated': '1' }
          : {}),
      },
    });
  } catch (err) {
    const elapsedMs = Date.now() - routeStartedAt;
    console.error('[api/voice/tts] unhandled', {
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    const message = err instanceof Error ? err.message : 'Internal error';
    const timedOut = isTtsTimeoutError(err);
    const billing = isTtsBillingError(err);
    const rateLimited = isTtsRateLimitError(err);
    const misconfigured = isTtsConfigError(err);
    const status = timedOut
      ? 504
      : billing
        ? 402
        : rateLimited
          ? 429
          : misconfigured
            ? 503
            : 500;
    notifyJackieFailure({
      kind: timedOut ? 'tts_timeout' : 'tts_5xx',
      reason: `[${resolveTtsProvider()}] ${message}`.slice(0, 280),
      orgId: auth?.organization.id ?? null,
      orgName: auth?.organization.name ?? null,
      route: '/api/voice/tts',
    });
    return NextResponse.json(
      {
        error: message,
        voicePlaybackFailed: true,
        /** Clients should keep showing the text reply when audio fails. */
        degradeToText: true,
        ...(billing ? { fishBilling: true } : {}),
        ...(rateLimited ? { fishRateLimited: true } : {}),
      },
      { status },
    );
  }
}
