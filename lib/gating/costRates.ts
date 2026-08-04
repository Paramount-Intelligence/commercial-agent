/**
 * Estimated cost rates — admin projections only, not billed truth.
 *
 * LLM: Anthropic Claude Sonnet (see lib/agent/loop.ts).
 * TTS: Fish Audio character pricing (see FISH_TTS_MODEL; *-free → $0).
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
   * Fish Audio paid TTS — estimated $/1,000 characters.
   * FLAG: confirm against Fish dashboard pricing; label UI as estimated.
   * When FISH_TTS_MODEL ends with `-free`, estimateTtsCostUsd returns 0.
   */
  FISH_TTS_RATE_PER_1K_CHARS: 0.015,
  /**
   * @deprecated TTS moved to Fish — kept for rollback dashboards only.
   * // TODO: remove after prod verification of Fish TTS.
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

/** Active Fish TTS model string (header), defaulting to production s2.1-pro. */
export function resolveFishTtsModel(): string {
  return (
    process.env.FISH_TTS_MODEL?.trim() ||
    's2.1-pro'
  );
}

/** True when the configured Fish model is a $0 *-free tier. */
export function isFishTtsFreeModel(model = resolveFishTtsModel()): boolean {
  return /(?:^|[\s/_-])free$/i.test(model.trim()) || /-free$/i.test(model.trim());
}

export function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  return (
    (tokensIn / 1_000_000) * COST_RATES.INPUT_RATE_PER_M +
    (tokensOut / 1_000_000) * COST_RATES.OUTPUT_RATE_PER_M
  );
}

/**
 * Estimated Fish / ElevenLabs TTS spend from character count.
 * *-free Fish models map to $0 — character ceilings in voiceLimit still apply
 * (abuse protection is independent of dollar cost).
 * When TTS_PROVIDER=elevenlabs (default), uses ElevenLabs rate.
 */
export function estimateTtsCostUsd(ttsChars: number): number {
  if (ttsChars <= 0) return 0;
  const provider = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (provider === 'fish') {
    if (isFishTtsFreeModel()) return 0;
    return (ttsChars / 1_000) * COST_RATES.FISH_TTS_RATE_PER_1K_CHARS;
  }
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
