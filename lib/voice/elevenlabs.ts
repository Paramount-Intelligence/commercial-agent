/**
 * ElevenLabs TTS client — the "mouth".
 *
 * Speaks text it is GIVEN. Does not generate or validate content; the agent
 * loop / chat UI must only pass already-validated assistant text here.
 *
 * Uses POST /v1/text-to-speech/{voiceId}/stream so audio can start playing
 * before the full clip is generated.
 */
import { VOICE_CONFIG } from './config';

export type SynthesizeOpts = {
  voiceId?: string;
  modelId?: string;
};

export type SynthesizeResult = {
  /** Streaming MP3 body from ElevenLabs. */
  stream: ReadableStream<Uint8Array>;
  /** Character count consumed (for org metering). */
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

/**
 * Stream MP3 speech for `text` via ElevenLabs streaming TTS.
 * Returns the readable stream + char count for metering.
 */
export async function synthesizeSpeech(
  text: string,
  opts?: SynthesizeOpts,
): Promise<SynthesizeResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('TTS text is empty');
  }

  const apiKey = requireApiKey();
  const voiceId = opts?.voiceId?.trim() || VOICE_CONFIG.DEFAULT_VOICE_ID;
  const modelId = opts?.modelId?.trim() || VOICE_CONFIG.DEFAULT_MODEL_ID;
  const chars = trimmed.length;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: trimmed,
      model_id: modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
      },
    }),
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

  // Next/undici rejects re-wrapping a locked fetch body. Pipe through a fresh
  // TransformStream so the route can return it as a new Response safely.
  const stream = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>());

  return { stream, chars };
}
