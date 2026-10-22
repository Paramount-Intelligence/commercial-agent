/**
 * Fish Audio TTS client — Jackie's mouth.
 *
 * Speaks text it is GIVEN. Does not generate or validate content; the agent
 * loop / chat UI must only pass already-validated assistant text here.
 *
 * Format: mp3 (barge-in / MediaSource `audio/mpeg` stay format-matched).
 * Latency: balanced (lower TTFA under Vercel time limits).
 *
 * Hard guarantees vs the Vercel 60s platform kill:
 * - Caps spoken text (VOICE_CONFIG.MAX_CHARS_PER_REQUEST)
 * - AbortController covers TTFB and the streamed body
 * - Returns after the first audio bytes, then proxies the remaining MP3 so
 *   browser playback can begin before synthesis completes
 */
import { VOICE_CONFIG } from './config';
import { withFishTtsSlot } from './fishQueue';

export type SynthesizeOpts = {
  /** Override Fish reference_id (voice). Defaults to FISH_VOICE_ID. */
  voiceId?: string;
  /** Override Fish model header. Defaults to FISH_TTS_MODEL / s2.1-pro. */
  modelId?: string;
  /** Optional AbortSignal from the caller (combined with the fetch timeout). */
  signal?: AbortSignal;
};

export type SynthesizeResult = {
  /** Live MP3 stream, primed with Fish's first non-empty audio chunk. */
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
      `Voice playback timed out waiting for Fish Audio after ${timeoutMs}ms (textChars=${inputChars}). Try a shorter answer, or continue in text.`,
    );
    this.name = 'TtsTimeoutError';
  }
}

/** Missing / misconfigured Fish env — route maps this to degrade-to-text. */
export class TtsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsConfigError';
  }
}

/** Fish returned 402 — API credit empty. Not a code bug; degrade to text. */
export class TtsBillingError extends Error {
  constructor(detail: string) {
    super(
      `Fish Audio API credit exhausted (402). Add funds at https://fish.audio/app/developers, or set FISH_TTS_MODEL=s2.1-pro-free for local eval. ${detail}`.slice(
        0,
        400,
      ),
    );
    this.name = 'TtsBillingError';
  }
}

/** Fish returned 429 — concurrency / rate limit. */
export class TtsRateLimitError extends Error {
  constructor(detail: string) {
    super(
      `Fish Audio TTS rate limited (429). ${detail}`.slice(0, 400),
    );
    this.name = 'TtsRateLimitError';
  }
}

function requireApiKey(): string {
  const key = process.env.FISH_API_KEY?.trim();
  if (!key) {
    console.error(
      '[voice/tts] FISH_API_KEY is not set — cannot synthesize speech. Degrade to text.',
    );
    throw new TtsConfigError(
      'FISH_API_KEY is not set. Add it to .env.local / Vercel (Fish Audio dashboard → API Key).',
    );
  }
  return key;
}

function requireVoiceId(override?: string): string {
  // Fish voice must come from env — never invent a reference_id.
  const voiceId = override?.trim() || process.env.FISH_VOICE_ID?.trim() || '';
  if (!voiceId) {
    console.error(
      '[voice/tts] FISH_VOICE_ID is not set — paste a female-voice reference_id from the Fish voice library. Degrade to text.',
    );
    throw new TtsConfigError(
      'FISH_VOICE_ID is not set. Paste a Fish Audio voice reference_id into env (server-side only).',
    );
  }
  return voiceId;
}

function resolveModelId(override?: string): string {
  return (
    override?.trim() ||
    process.env.FISH_TTS_MODEL?.trim() ||
    's2.1-pro'
  );
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
  // Prefer ending on a sentence if we can keep most of the budget.
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('!\n'),
    slice.lastIndexOf('?\n'),
  );
  const cut =
    sentenceEnd > max * 0.55
      ? slice.slice(0, sentenceEnd + 1).trimEnd()
      : slice.trimEnd();

  return {
    text: cut || slice,
    inputChars,
    truncated: true,
  };
}

/**
 * Synthesize MP3 speech for `text` via Fish Audio TTS.
 * Serialized + retried on 429 so voice boot / chunked replies don't trip
 * Fish's concurrent-request limit (Starter = 5).
 */
export async function synthesizeSpeech(
  text: string,
  opts?: SynthesizeOpts,
): Promise<SynthesizeResult> {
  return withFishTtsSlot(() => synthesizeSpeechOnce(text, opts));
}

async function synthesizeSpeechOnce(
  text: string,
  opts?: SynthesizeOpts,
): Promise<SynthesizeResult> {
  const { text: spoken, inputChars, truncated } = truncateForTts(text);
  if (!spoken) {
    throw new Error('TTS text is empty');
  }

  const apiKey = requireApiKey();
  const voiceId = requireVoiceId(opts?.voiceId);
  const modelId = resolveModelId(opts?.modelId);
  const chars = spoken.length;
  const timeoutMs = VOICE_CONFIG.TTS_FETCH_TIMEOUT_MS;
  const url = 'https://api.fish.audio/v1/tts';
  const maxAttempts = 4;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);
    let signal: AbortSignal = timeoutController.signal;
    if (opts?.signal) {
      const combined = new AbortController();
      const forward = () => combined.abort();
      if (opts.signal.aborted || timeoutController.signal.aborted) {
        combined.abort();
      } else {
        opts.signal.addEventListener('abort', forward, { once: true });
        timeoutController.signal.addEventListener('abort', forward, {
          once: true,
        });
      }
      signal = combined.signal;
    }

    const startedAt = Date.now();
    let streamOwnsDeadline = false;
    console.info('[voice/tts] fish request', {
      inputChars,
      spokenChars: chars,
      truncated,
      voiceId,
      modelId,
      format: 'mp3',
      mp3Bitrate: VOICE_CONFIG.MP3_BITRATE,
      latency: 'balanced',
      timeoutMs,
      mode: 'first-byte-stream',
      attempt,
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          model: modelId,
        },
        body: JSON.stringify({
          text: spoken,
          reference_id: voiceId,
          format: 'mp3',
          mp3_bitrate: VOICE_CONFIG.MP3_BITRATE,
          latency: 'balanced',
          chunk_length: 120,
        }),
        signal,
      });

      const headerMs = Date.now() - startedAt;
      console.info('[voice/tts] fish response headers', {
        status: res.status,
        headerMs,
        inputChars,
        spokenChars: chars,
        truncated,
        ok: res.ok,
        contentType: res.headers.get('content-type'),
        attempt,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (res.status === 402) {
          console.error('[voice/tts] fish billing 402 — insufficient API credit', {
            modelId,
            voiceId,
            detail: errBody.slice(0, 200),
          });
          throw new TtsBillingError(errBody.slice(0, 160));
        }
        if (res.status === 429) {
          const retryable = attempt < maxAttempts;
          console.warn('[voice/tts] fish 429 concurrency/rate limit', {
            attempt,
            retryable,
            detail: errBody.slice(0, 160),
          });
          if (retryable) {
            const waitMs = Math.min(8_000, 400 * 2 ** (attempt - 1));
            await new Promise((r) => setTimeout(r, waitMs));
            lastErr = new TtsRateLimitError(errBody.slice(0, 160));
            continue;
          }
          throw new TtsRateLimitError(errBody.slice(0, 160));
        }
        throw new Error(
          `Fish Audio TTS failed (${res.status}): ${errBody.slice(0, 240) || res.statusText}`,
        );
      }

      if (!res.body) {
        throw new Error('Fish Audio TTS returned an empty response body');
      }
      const reader = res.body.getReader();
      const first = await reader.read();
      if (first.done || !first.value?.byteLength) {
        await reader.cancel().catch(() => {});
        throw new Error('Fish Audio TTS returned an empty response body');
      }

      console.info('[voice/tts] fish first audio bytes', {
        elapsedMs: Date.now() - startedAt,
        bytes: first.value.byteLength,
        spokenChars: chars,
        truncated,
        attempt,
      });

      streamOwnsDeadline = true;
      let firstChunk: Uint8Array | null = first.value;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (firstChunk) {
              controller.enqueue(firstChunk);
              firstChunk = null;
              return;
            }
            const next = await reader.read();
            if (next.done) {
              clearTimeout(timeoutHandle);
              controller.close();
              return;
            }
            if (next.value.byteLength) controller.enqueue(next.value);
          } catch (error) {
            clearTimeout(timeoutHandle);
            controller.error(error);
          }
        },
        async cancel(reason) {
          clearTimeout(timeoutHandle);
          await reader.cancel(reason).catch(() => {});
        },
      });

      return {
        stream,
        chars,
        inputChars,
        truncated,
      };
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      if (err instanceof TtsBillingError || err instanceof TtsRateLimitError) {
        throw err;
      }
      if (isAbortError(err) || timeoutController.signal.aborted) {
        console.error('[voice/tts] fish fetch timed out', {
          elapsedMs,
          inputChars,
          spokenChars: chars,
          truncated,
          timeoutMs,
          attempt,
        });
        throw new TtsTimeoutError(timeoutMs, inputChars);
      }
      console.error('[voice/tts] fish fetch failed', {
        elapsedMs,
        inputChars,
        spokenChars: chars,
        truncated,
        error: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        attempt,
      });
      throw err;
    } finally {
      if (!streamOwnsDeadline) clearTimeout(timeoutHandle);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new TtsRateLimitError('Exceeded Fish Audio concurrency retries');
}
