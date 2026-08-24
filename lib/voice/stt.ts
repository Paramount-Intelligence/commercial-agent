/**
 * Fish Audio ASR — the "ears".
 *
 * Transcribes audio it is GIVEN. Does not run the agent; /api/voice/stt
 * returns text so the existing chat/agent loop can continue.
 *
 * POST https://api.fish.audio/v1/asr (multipart)
 */
import { usableSpeechText } from './speechFilter';

export type TranscribeResult = {
  text: string;
  languageCode: string | null;
  /** Audio duration in seconds (from API when present; else estimated). */
  durationSeconds: number;
  /** Rounded-up whole seconds for OrgUsageDay metering. */
  meteredSeconds: number;
  chars: number;
};

/** Fish returned 402 — API credit empty. ASR has no *-free model. */
export class SttBillingError extends Error {
  constructor(detail: string) {
    super(
      `Fish Audio ASR credit exhausted (402). Add API credit at https://fish.audio/app/developers (separate from platform credit; s2.1-pro-free only covers TTS). ${detail}`.slice(
        0,
        400,
      ),
    );
    this.name = 'SttBillingError';
  }
}

export function isSttBillingError(err: unknown): boolean {
  return err instanceof SttBillingError;
}

function requireApiKey(): string {
  const key = process.env.FISH_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'FISH_API_KEY is not set. Add it to .env.local (Fish Audio dashboard → API Key).',
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

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as Error & { cause?: { code?: string; name?: string } })
    .cause;
  const code = cause?.code ?? '';
  const name = cause?.name ?? err.name;
  const msg = err.message.toLowerCase();
  return (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    name === 'ConnectTimeoutError' ||
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('aborted') ||
    msg.includes('timeout')
  );
}

async function postSpeechToText(
  form: FormData,
  apiKey: string,
  timeoutMs: number,
): Promise<Response> {
  return fetch('https://api.fish.audio/v1/asr', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    // Keep short so a hung STT cannot pin Next.js + Prisma pool for a minute.
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Transcribe an audio buffer via Fish Audio ASR.
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

  const buildForm = () => {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mime });
    form.append('audio', blob, filename);
    form.append('language', 'en');
    form.append('ignore_timestamps', 'true');
    return form;
  };

  const primaryTimeoutMs = 28_000;
  const retryTimeoutMs = 20_000;

  let res: Response;
  try {
    res = await postSpeechToText(buildForm(), apiKey, primaryTimeoutMs);
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    console.warn('[voice/stt] transient network error — retrying once', {
      message: err instanceof Error ? err.message : String(err),
      cause:
        err instanceof Error && 'cause' in err
          ? String((err as Error & { cause?: unknown }).cause)
          : undefined,
    });
    try {
      res = await postSpeechToText(buildForm(), apiKey, retryTimeoutMs);
    } catch (retryErr) {
      if (isTransientNetworkError(retryErr)) {
        throw new Error(
          'Voice transcription timed out reaching Fish Audio. Check your network, then try speaking again.',
        );
      }
      throw retryErr;
    }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 402) {
      console.error('[voice/stt] fish billing 402 — insufficient API credit', {
        detail: errBody.slice(0, 200),
      });
      throw new SttBillingError(errBody.slice(0, 160));
    }
    if (
      res.status === 400 &&
      /could not be decoded|format not recognised|invalid audio/i.test(errBody)
    ) {
      throw new Error(
        'Voice recording format was not accepted. Please try speaking again.',
      );
    }
    throw new Error(
      `Fish Audio STT failed (${res.status}): ${errBody.slice(0, 240) || res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    text?: string;
    language_code?: string | null;
    duration?: number | null;
    segments?: Array<{ end?: number | null }>;
  };

  const rawText = (data.text ?? '').trim();
  const text = usableSpeechText(rawText) ?? '';

  let durationSeconds = 0;
  if (
    typeof data.duration === 'number' &&
    Number.isFinite(data.duration) &&
    data.duration > 0
  ) {
    durationSeconds = data.duration;
  } else if (Array.isArray(data.segments) && data.segments.length > 0) {
    const lastEnd = data.segments.reduce((max, seg) => {
      const e = typeof seg.end === 'number' ? seg.end : 0;
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
    console.warn('[voice/stt] Fish ASR returned no usable speech', {
      mime,
      bytes: audioBuffer.length,
      durationSeconds,
      languageCode: data.language_code ?? null,
      segmentCount: data.segments?.length ?? 0,
      rawPreview: rawText.slice(0, 80),
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
