export type VoiceSttProvider = 'deepgram' | 'fish';

export const DEEPGRAM_FLUX_CONFIG = {
  model: 'flux-general-en',
  eagerEotThreshold: 0.6,
  eotThreshold: 0.8,
  eotTimeoutMs: 6_000,
  frameMs: 80,
  maxSessionMs: 30 * 60 * 1_000,
  reconnect: {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
  },
} as const;

/** Fresh-token reconnect delay with bounded exponential backoff. */
export function fluxReconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(
    DEEPGRAM_FLUX_CONFIG.reconnect.maxDelayMs,
    DEEPGRAM_FLUX_CONFIG.reconnect.baseDelayMs * 2 ** safeAttempt,
  );
}

export function voiceSttProvider(
  env: Record<string, string | undefined> = process.env,
): VoiceSttProvider {
  return env.NEXT_PUBLIC_VOICE_STT_PROVIDER?.trim().toLowerCase() === 'fish'
    ? 'fish'
    : 'deepgram';
}

export function fishSttFallbackEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NEXT_PUBLIC_VOICE_STT_FALLBACK?.trim() !== '0';
}

/** Fish captures directly when selected, or while Flux is unavailable. */
export function fishListeningEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return voiceSttProvider(env) === 'fish' || fishSttFallbackEnabled(env);
}

export function eagerEotEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NEXT_PUBLIC_DEEPGRAM_EAGER_EOT?.trim() !== '0';
}
