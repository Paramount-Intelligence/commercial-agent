/**
 * ElevenLabs TTS client — active default mouth (via lib/voice/tts.ts).
 *
 * Switch away with TTS_PROVIDER=fish when the ElevenLabs subscription ends.
 * STT also uses ELEVENLABS_API_KEY via lib/voice/stt.ts.
 *
 * Speaks text it is GIVEN. Does not generate or validate content; the agent
 * loop / chat UI must only pass already-validated assistant text here.
 *
 * Uses POST /v1/text-to-speech/{voiceId}/stream so audio can start playing
 * before the full clip is generated.
 *
 * Hard guarantees vs platform timeouts:
 * - Caps spoken text length (VOICE_CONFIG.MAX_CHARS_PER_REQUEST)
 * - Aborts the ElevenLabs fetch if headers/body start hang past TTS_FETCH_TIMEOUT_MS
 */
import { VOICE_CONFIG } from './config';

export type SynthesizeOpts = {
  voiceId?: string;
  modelId?: string;
  /** Optional AbortSignal from the caller (combined with the fetch timeout). */
  signal?: AbortSignal;
};

export type SynthesizeResult = {
  /** Streaming MP3 body from ElevenLabs. */
  stream: ReadableStream<Uint8Array>;
  /** Character count consumed (for org metering) — after truncation. */
  chars: number;
  /** Original cleaned length before the per-request cap. */
  inputChars: number;
  /** True when text was truncated to fit MAX_CHARS_PER_REQUEST. */
  truncated: boolean;
};

export class TtsTimeoutError extends Error {
  constructor(timeoutMs: number, inputChars: number) {
    super(
      `Voice playback timed out waiting for ElevenLabs after ${timeoutMs}ms (textChars=${inputChars}). Try a shorter answer, or continue in text.`,
    );
    this.name = 'TtsTimeoutError';
  }
}

function requireApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'ELEVENLABS_API_KEY is not set. Add it to .env.local (ElevenLabs dashboard → API Key).',
    );
  }
  return key;
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    /aborted|timeout/i.test(err.message)
  );
}

/**
 * Cap spoken text at MAX_CHARS_PER_REQUEST, preferring a sentence boundary
 * so TTS never synthesizes multi-minute monologues in one call.
 */
export function truncateForTts(text: string): {
  text: string;
  inputChars: number;
  truncated: boolean;
} {
  const trimmed = text.trim();
  const inputChars = trimmed.length;
  const max = VOICE_CONFIG.MAX_CHARS_PER_REQUEST;
  if (inputChars <= max) {
    return { text: trimmed, inputChars, truncated: false };
  }

  const slice = trimmed.slice(0, max);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('!\n'),
    slice.lastIndexOf('?\n'),
  );
  const cut =
    sentenceEnd > max * 0.55 ? slice.slice(0, sentenceEnd + 1).trimEnd() : slice.trimEnd();

  return {
    text: cut || slice,
    inputChars,
    truncated: true,
  };
}

/**
 * Stream MP3 speech for `text` via ElevenLabs streaming TTS.
 * Returns the readable stream + char count for metering.
 */
export async function synthesizeSpeech(
  text: string,
  opts?: SynthesizeOpts,
): Promise<SynthesizeResult> {
  const { text: spoken, inputChars, truncated } = truncateForTts(text);
  if (!spoken) {
    throw new Error('TTS text is empty');
  }

  const apiKey = requireApiKey();
  const voiceId =
    opts?.voiceId?.trim() || VOICE_CONFIG.DEFAULT_VOICE_ID?.trim() || '';
  if (!voiceId) {
    throw new Error(
      'Voice Agent is not set.',
    );
  }
  const modelId = opts?.modelId?.trim() || VOICE_CONFIG.DEFAULT_MODEL_ID;
  const chars = spoken.length;
  const timeoutMs = VOICE_CONFIG.TTS_FETCH_TIMEOUT_MS;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  let signal: AbortSignal = timeoutSignal;
  if (opts?.signal) {
    const combined = new AbortController();
    const forward = () => combined.abort();
    if (opts.signal.aborted || timeoutSignal.aborted) {
      combined.abort();
    } else {
      opts.signal.addEventListener('abort', forward, { once: true });
      timeoutSignal.addEventListener('abort', forward, { once: true });
    }
    signal = combined.signal;
  }

  const startedAt = Date.now();
  console.info('[voice/tts] elevenlabs request', {
    inputChars,
    spokenChars: chars,
    truncated,
    voiceId,
    modelId,
    timeoutMs,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: spoken,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      }),
      signal,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    console.error('[voice/tts] elevenlabs fetch failed', {
      elapsedMs,
      inputChars,
      spokenChars: chars,
      truncated,
      error: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    if (isAbortError(err)) {
      throw new TtsTimeoutError(timeoutMs, inputChars);
    }
    throw err;
  }

  const headerMs = Date.now() - startedAt;
  console.info('[voice/tts] elevenlabs response headers', {
    status: res.status,
    headerMs,
    inputChars,
    spokenChars: chars,
    truncated,
    ok: res.ok,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `ElevenLabs TTS failed (${res.status}): ${errBody.slice(0, 240) || res.statusText}`,
    );
  }

  if (!res.body) {
    throw new Error('ElevenLabs TTS returned an empty response body');
  }

  const stream = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>());

  return { stream, chars, inputChars, truncated };
}
