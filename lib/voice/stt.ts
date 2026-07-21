/**
 * ElevenLabs Scribe STT — the "ears".
 *
 * Transcribes audio it is GIVEN. Does not run the agent; Slice 3 will feed
 * the returned text into the existing chat/agent loop.
 *
 * POST https://api.elevenlabs.io/v1/speech-to-text (multipart)
 * Model: scribe_v2 (see VOICE_CONFIG.STT_MODEL_ID).
 */
import { VOICE_CONFIG } from './config';

export type TranscribeResult = {
  text: string;
  languageCode: string | null;
  /** Audio duration in seconds (from API when present; else estimated). */
  durationSeconds: number;
  /** Rounded-up whole seconds for OrgUsageDay metering. */
  meteredSeconds: number;
  chars: number;
};

function requireApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'ELEVENLABS_API_KEY is not set. Add it to .env.local (ElevenLabs dashboard → API Key).',
    );
  }
  return key;
}

function extForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * Transcribe an audio buffer via ElevenLabs Scribe.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
): Promise<TranscribeResult> {
  if (!audioBuffer?.length) {
    throw new Error('Audio buffer is empty');
  }

  const apiKey = requireApiKey();
  const mime = mimeType.trim() || 'audio/webm';
  const filename = `recording.${extForMime(mime)}`;

  const form = new FormData();
  // Blob is available in Node 18+ / Next.js runtime
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mime });
  form.append('file', blob, filename);
  form.append('model_id', VOICE_CONFIG.STT_MODEL_ID);
  // Bias toward English for commercial-adviser turns without locking language
  form.append('language_code', 'en');

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `ElevenLabs STT failed (${res.status}): ${errBody.slice(0, 240) || res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    text?: string;
    language_code?: string;
    language_probability?: number;
    audio_duration_secs?: number | null;
    words?: Array<{ end?: number | null }>;
  };

  const text = (data.text ?? '').trim();

  let durationSeconds = 0;
  if (
    typeof data.audio_duration_secs === 'number' &&
    Number.isFinite(data.audio_duration_secs) &&
    data.audio_duration_secs > 0
  ) {
    durationSeconds = data.audio_duration_secs;
  } else if (Array.isArray(data.words) && data.words.length > 0) {
    const lastEnd = data.words.reduce((max, w) => {
      const e = typeof w.end === 'number' ? w.end : 0;
      return e > max ? e : max;
    }, 0);
    durationSeconds = lastEnd;
  }

  // Fallback: rough estimate from byte size (~16kbps webm opus → ~2KB/s)
  if (durationSeconds <= 0) {
    durationSeconds = Math.max(1, audioBuffer.length / 2000);
  }

  const meteredSeconds = Math.max(1, Math.ceil(durationSeconds));

  if (!text) {
    console.warn('[voice/stt] Scribe returned no speech', {
      mime,
      bytes: audioBuffer.length,
      durationSeconds,
      languageCode: data.language_code ?? null,
      languageProbability: data.language_probability ?? null,
      wordCount: data.words?.length ?? 0,
    });
  }

  return {
    text,
    languageCode: data.language_code ?? null,
    durationSeconds,
    meteredSeconds,
    chars: text.length,
  };
}
