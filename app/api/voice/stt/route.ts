/**
 * POST /api/voice/stt — transcribe microphone audio to text (the "ears").
 *
 * Session-gated like /api/chat. Does NOT run the agent — returns { text } so
 * transcription quality can be verified before Slice 3 wires STT → agent loop.
 *
 * Body: multipart/form-data with field `audio` (Blob/File from MediaRecorder).
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import {
  reconcileSttReservation,
  releaseSttSeconds,
  reserveSttSeconds,
} from '@/lib/gating/voiceLimit';
import { VOICE_CONFIG } from '@/lib/voice/config';
import { transcribeAudio } from '@/lib/voice/stt';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_BYTES = 12 * 1024 * 1024; // ~12 MB — enough for ~2 min of webm
const STT_RESERVATION_SAFETY_SECONDS = 2;

export async function POST(req: Request) {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Expected multipart/form-data with an audio file field' },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const file = form.get('audio');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'audio file field is required' },
        { status: 400 },
      );
    }

    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Audio must be between 1 byte and ${MAX_BYTES / (1024 * 1024)} MB` },
        { status: 400 },
      );
    }

    const mimeType = file.type || 'audio/webm';
    const buffer = Buffer.from(await file.arrayBuffer());

    const durationValue = form.get('durationSeconds');
    const reportedDuration =
      typeof durationValue === 'string' ? Number(durationValue) : NaN;
    const reservationSeconds =
      Number.isFinite(reportedDuration) && reportedDuration > 0
        ? Math.min(
            VOICE_CONFIG.MAX_STT_SECONDS,
            Math.ceil(reportedDuration) + STT_RESERVATION_SAFETY_SECONDS,
          )
        : VOICE_CONFIG.MAX_STT_SECONDS;

    const voiceQuota = await reserveSttSeconds(
      auth.organization.id,
      reservationSeconds,
      auth.organization.dailySttSecondLimit,
    );
    if (!voiceQuota.allowed) {
      return NextResponse.json({
        voiceLimitReached: true,
        modality: 'stt',
        used: voiceQuota.used,
        limit: voiceQuota.limit,
        notice:
          "We've reached today's voice-input limit for your organization. You can keep going in text chat.",
      });
    }

    console.info('[api/voice/stt] received audio', {
      bytes: buffer.length,
      mimeType,
      filename: file.name,
    });
    let result: Awaited<ReturnType<typeof transcribeAudio>>;
    try {
      result = await transcribeAudio(buffer, mimeType);
    } catch (error) {
      await releaseSttSeconds(
        auth.organization.id,
        voiceQuota.reserved,
      ).catch((releaseError) => {
        console.error('[api/voice/stt] reservation release failed', releaseError);
      });
      throw error;
    }

    try {
      await reconcileSttReservation(
        auth.organization.id,
        voiceQuota.reserved,
        result.meteredSeconds,
        auth.organization.dailySttSecondLimit,
      );
    } catch (meterErr) {
      console.error('[api/voice/stt] reservation reconciliation failed', meterErr);
    }

    if (result.meteredSeconds > VOICE_CONFIG.MAX_STT_SECONDS) {
      return NextResponse.json(
        {
          error: `Recording exceeds ${VOICE_CONFIG.MAX_STT_SECONDS}s STT limit`,
        },
        { status: 400 },
      );
    }

    if (!result.text) {
      return NextResponse.json(
        {
          error:
            'No speech was detected. Check the selected microphone, speak for 2–3 seconds, then stop recording.',
          durationSeconds: result.durationSeconds,
          meteredSeconds: result.meteredSeconds,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      text: result.text,
      languageCode: result.languageCode,
      durationSeconds: result.durationSeconds,
      meteredSeconds: result.meteredSeconds,
      chars: result.chars,
    });
  } catch (err) {
    console.error('[api/voice/stt] unhandled', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = /ELEVENLABS_API_KEY/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
