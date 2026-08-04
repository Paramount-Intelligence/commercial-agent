/**
 * Fish Audio TTS client — standby mouth (activate with TTS_PROVIDER=fish).
 *
 * Speaks text it is GIVEN. Does not generate or validate content; the agent
 * loop / chat UI must only pass already-validated assistant text here.
 *
 * Slice 1: request `format:"mp3"` so barge-in thresholds and client
 * `<audio>` / MediaSource (`audio/mpeg`) paths stay unchanged.
 *
 * // TODO(slice-2): switch to pcm/opus + latency:"balanced" for lower TTFA,
 * then retune VAD barge-in against the new format. Do not do that in this PR.
 *
 * Hard guarantees vs platform timeouts:
 * - Caps spoken text length (VOICE_CONFIG.MAX_CHARS_PER_REQUEST)
 * - Aborts the Fish fetch if headers/body start hang past TTS_FETCH_TIMEOUT_MS
 */
import { VOICE_CONFIG } from './config';

export type SynthesizeOpts = {
  /** Override Fish reference_id (voice). Defaults to FISH_VOICE_ID. */
  voiceId?: string;
  /** Override Fish model header. Defaults to FISH_TTS_MODEL / s2.1-pro. */
  modelId?: string;
  /** Optional AbortSignal from the caller (combined with the fetch timeout). */
  signal?: AbortSignal;
};

export type SynthesizeResult = {
  /** MP3 body stream (Fish returns raw audio bytes; we expose as a stream). */
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
  // Fish voice must come from env — never fall back to ElevenLabs Amy id.
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
    sentenceEnd > max * 0.55 ? slice.slice(0, sentenceEnd + 1).trimEnd() : slice.trimEnd();

  return {
    text: cut || slice,
    inputChars,
    truncated: true,
  };
}

/**
 * Synthesize MP3 speech for `text` via Fish Audio TTS.
 * Returns a readable stream + char count for metering.
 *
 * Format is deliberately `mp3` @ 128kbps to match the prior ElevenLabs
 * `audio/mpeg` client path (Slice 1).
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
  const voiceId = requireVoiceId(opts?.voiceId);
  const modelId = resolveModelId(opts?.modelId);
  const chars = spoken.length;
  const timeoutMs = VOICE_CONFIG.TTS_FETCH_TIMEOUT_MS;

  const url = 'https://api.fish.audio/v1/tts';

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  let signal: AbortSignal = timeoutSignal;
  if (opts?.signal) {
    // Combine caller abort with the hard fetch timeout without AbortSignal.any
    // (older runtimes). Either abort cancels the Fish request.
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
  console.info('[voice/tts] fish request', {
    inputChars,
    spokenChars: chars,
    truncated,
    voiceId,
    modelId,
    format: 'mp3',
    mp3Bitrate: VOICE_CONFIG.MP3_BITRATE,
    timeoutMs,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Required by Fish — model is a header, not a body field.
        model: modelId,
      },
      body: JSON.stringify({
        text: spoken,
        reference_id: voiceId,
        format: 'mp3',
        mp3_bitrate: VOICE_CONFIG.MP3_BITRATE,
        // Slice 1: keep "normal" so TTFA/format stays close to prior path.
        // TODO(slice-2): latency: "balanced" with pcm/opus + barge-in retune.
        latency: 'normal',
      }),
      signal,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    console.error('[voice/tts] fish fetch failed', {
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
  console.info('[voice/tts] fish response headers', {
    status: res.status,
    headerMs,
    inputChars,
    spokenChars: chars,
    truncated,
    ok: res.ok,
    contentType: res.headers.get('content-type'),
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
    throw new Error(
      `Fish Audio TTS failed (${res.status}): ${errBody.slice(0, 240) || res.statusText}`,
    );
  }

  if (!res.body) {
    throw new Error('Fish Audio TTS returned an empty response body');
  }

  // Next/undici rejects re-wrapping a locked fetch body. Pipe through a fresh
  // TransformStream so the route can return it as a new Response safely.
  const stream = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>());

  return { stream, chars, inputChars, truncated };
}
