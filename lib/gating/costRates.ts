/**
 * Estimated cost rates — admin projections only, not billed truth.
 *
 * LLM: Anthropic Claude Sonnet (see lib/agent/loop.ts).
 * TTS: ElevenLabs Flash/Turbo character pricing (Creator-tier ballpark).
 * STT: ElevenLabs Scribe v2 — billed per hour of audio ($0.22/hr API list).
 */
export const COST_RATES = {
  /** Claude Sonnet input tokens — $/1M */
  INPUT_RATE_PER_M: 3.0,
  /** Claude Sonnet output tokens — $/1M */
  OUTPUT_RATE_PER_M: 15.0,
  /** text-embedding-3-small (case/website corpus) — $/1M; optional */
  EMBEDDING_RATE_PER_M: 0.02,
  /**
   * ElevenLabs TTS — estimated $/1,000 characters (Flash/Turbo Creator tier).
   * Always label dashboard figures as estimated.
   */
  ELEVENLABS_RATE_PER_1K_CHARS: 0.06,
  /**
   * ElevenLabs Scribe v2 STT — estimated $/hour of audio (API list ~$0.22/hr).
   * FLAG: update when ElevenLabs changes Scribe pricing.
   */
  ELEVENLABS_STT_RATE_PER_HOUR: 0.22,
} as const;

/**
 * Protective per-org default. At an illustrative Sonnet mix of 85% input and
 * 15% output, 1M tokens costs about $4.80:
 * 0.85 × $3 + 0.15 × $15.
 */
export const DEFAULT_DAILY_LLM_TOKEN_LIMIT = 1_000_000;

export function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  return (
    (tokensIn / 1_000_000) * COST_RATES.INPUT_RATE_PER_M +
    (tokensOut / 1_000_000) * COST_RATES.OUTPUT_RATE_PER_M
  );
}

/** Estimated ElevenLabs TTS spend from character count. */
export function estimateTtsCostUsd(ttsChars: number): number {
  if (ttsChars <= 0) return 0;
  return (ttsChars / 1_000) * COST_RATES.ELEVENLABS_RATE_PER_1K_CHARS;
}

/** Estimated ElevenLabs Scribe STT spend from audio seconds. */
export function estimateSttCostUsd(sttSeconds: number): number {
  if (sttSeconds <= 0) return 0;
  return (sttSeconds / 3600) * COST_RATES.ELEVENLABS_STT_RATE_PER_HOUR;
}

/** Combined estimated LLM + TTS + STT cost. */
export function estimateTotalCostUsd(
  tokensIn: number,
  tokensOut: number,
  ttsChars: number,
  sttSeconds = 0,
): number {
  return (
    estimateCostUsd(tokensIn, tokensOut) +
    estimateTtsCostUsd(ttsChars) +
    estimateSttCostUsd(sttSeconds)
  );
}
