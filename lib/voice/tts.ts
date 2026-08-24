/**
 * TTS provider — Fish Audio is the only mouth for /api/voice/tts.
 */
import type { SynthesizeOpts, SynthesizeResult } from './fishAudio';
import * as fishAudio from './fishAudio';
import { splitTextForTtsChunks } from './ttsChunks';

export type { SynthesizeOpts, SynthesizeResult };
export { splitTextForTtsChunks };

export type TtsProviderName = 'fish';

export function resolveTtsProvider(): TtsProviderName {
  return 'fish';
}

export function truncateForTts(text: string) {
  return fishAudio.truncateForTts(text);
}

export async function synthesizeSpeech(
  text: string,
  opts?: SynthesizeOpts,
): Promise<SynthesizeResult> {
  console.info('[voice/tts] provider', { provider: 'fish' });
  return fishAudio.synthesizeSpeech(text, opts);
}

export function isTtsTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TtsTimeoutError' ||
    /timed out waiting for Fish Audio/i.test(err.message)
  );
}

export function isTtsConfigError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TtsConfigError' ||
    /FISH_API_KEY|FISH_VOICE_ID/i.test(err.message)
  );
}

export function isTtsBillingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TtsBillingError' ||
    /\(402\)|Insufficient API credit/i.test(err.message)
  );
}

export function isTtsRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TtsRateLimitError' ||
    /\(429\)|rate limited|concurrency limit/i.test(err.message)
  );
}
