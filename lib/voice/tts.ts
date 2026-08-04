/**
 * TTS provider switch — active mouth for /api/voice/tts.
 *
 * Default: ElevenLabs (current subscription).
 * Flip to Fish when ElevenLabs ends: TTS_PROVIDER=fish (+ FISH_API_KEY, FISH_VOICE_ID).
 *
 * Both providers return audio/mpeg (mp3) in Slice 1 so barge-in / client playback
 * stay format-matched.
 */
import type { SynthesizeOpts, SynthesizeResult } from './elevenlabs';
import * as elevenlabs from './elevenlabs';
import * as fishAudio from './fishAudio';

export type { SynthesizeOpts, SynthesizeResult };

export type TtsProviderName = 'elevenlabs' | 'fish';

export function resolveTtsProvider(): TtsProviderName {
  const raw = process.env.TTS_PROVIDER?.trim().toLowerCase();
  return raw === 'fish' ? 'fish' : 'elevenlabs';
}

export function truncateForTts(text: string) {
  return resolveTtsProvider() === 'fish'
    ? fishAudio.truncateForTts(text)
    : elevenlabs.truncateForTts(text);
}

export async function synthesizeSpeech(
  text: string,
  opts?: SynthesizeOpts,
): Promise<SynthesizeResult> {
  const provider = resolveTtsProvider();
  console.info('[voice/tts] provider', { provider });
  if (provider === 'fish') {
    return fishAudio.synthesizeSpeech(text, opts);
  }
  return elevenlabs.synthesizeSpeech(text, opts);
}

export function isTtsTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TtsTimeoutError' ||
    /timed out waiting for (?:Fish Audio|ElevenLabs)/i.test(err.message)
  );
}

export function isTtsConfigError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TtsConfigError' ||
    /FISH_API_KEY|FISH_VOICE_ID|ELEVENLABS_API_KEY/i.test(err.message)
  );
}

export function isTtsBillingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TtsBillingError' ||
    /\(402\)|Insufficient API credit/i.test(err.message)
  );
}
