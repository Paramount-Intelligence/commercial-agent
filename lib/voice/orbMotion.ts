export type OrbConversationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export function orbBackingStoreSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
) {
  const dpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
  return {
    width: Math.max(1, Math.ceil(Math.max(0, cssWidth) * dpr)),
    height: Math.max(1, Math.ceil(Math.max(0, cssHeight) * dpr)),
    dpr,
  } as const;
}

export function smoothOrbLevel(
  current: number,
  target: number,
  elapsedMs: number,
  attackMs = 60,
  releaseMs = 250,
): number {
  const safeTarget = Math.max(0, Math.min(1, target));
  const duration = safeTarget > current ? attackMs : releaseMs;
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / Math.max(1, duration));
  return current + (safeTarget - current) * alpha;
}

export function mapOrbState(
  state: OrbConversationState,
  microphoneLevel: number,
  outputLevel: number,
) {
  const mic = Math.max(0, Math.min(1, microphoneLevel));
  const output = Math.max(0, Math.min(1, outputLevel));
  const level = state === 'speaking' ? output : state === 'listening' ? mic : 0;
  return {
    level,
    mode: state === 'listening' ? 1 : state === 'thinking' ? 2 : state === 'speaking' ? 3 : 0,
    scale: 1 + level * (state === 'speaking' ? 0.06 : 0.05),
    speed: state === 'thinking' ? 0.12 : 0.07 + level * 0.32,
    ice: state === 'listening' ? 0.24 + mic * 0.58 : 0.12,
    violet: state === 'speaking' ? Math.max(0, output - 0.58) * 1.55 : 0,
  } as const;
}
