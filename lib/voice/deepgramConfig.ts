export type VoiceSttProvider = 'deepgram' | 'fish';

export const DEEPGRAM_FLUX_CONFIG = {
  model: 'flux-general-en',
  eagerEotThreshold: 0.6,
  eotThreshold: 0.8,
  eotTimeoutMs: 6_000,
  frameMs: 80,
  maxSessionMs: 30 * 60 * 1_000,
} as const;

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

export function eagerEotEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NEXT_PUBLIC_DEEPGRAM_EAGER_EOT?.trim() !== '0';
}
