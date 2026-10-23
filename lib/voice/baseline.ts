import type { VoiceTimingSummary } from './turnTiming';

export const VOICE_BASELINE_EVENT = 'voice-baseline';

export const VOICE_ACCEPTANCE_TARGETS = {
  warmMicReadyP95Ms: 500,
  coldMicReadyP95Ms: 1_500,
  firstAudioP50Ms: 1_200,
  firstAudioP95Ms: 2_000,
  interruptionStopP95Ms: 300,
  fluxUsagePercent: 99,
  falseInterruptionPercent: 1,
} as const;

export type VoiceSessionMark =
  | 'mounted'
  | 'historyRequested'
  | 'historyReady'
  | 'micRequested'
  | 'micReady'
  | 'fluxRequested'
  | 'fluxConnected'
  | 'introRequested'
  | 'introReady'
  | 'setupReady';

export type VoiceSessionTiming = {
  id: string;
  startedAt: string;
  warm: boolean;
  deviceLabel: string;
  runLabel: string;
  userAgent: string;
  viewport: string;
  network: string;
  marks: Partial<Record<VoiceSessionMark, number>>;
  meta: Record<string, string | number | boolean | null>;
};

export type VoiceInterruptionTiming = {
  id: string;
  source: 'local-vad' | 'flux-start' | 'stop-button';
  detectedAt: number;
  stoppedAt?: number;
  confirmedAt?: number;
  confirmed: boolean | null;
  stopMs: number | null;
};

export type VoiceBaselineBundle = {
  exportedAt: string;
  targets: typeof VOICE_ACCEPTANCE_TARGETS;
  sessions: VoiceSessionTiming[];
  turns: VoiceTimingSummary[];
  interruptions: VoiceInterruptionTiming[];
  summary: VoiceBaselineSummary;
};

export type BaselineMetric = {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

export type VoiceBaselineSummary = {
  coldMicReady: BaselineMetric;
  warmMicReady: BaselineMetric;
  fluxConnect: BaselineMetric;
  firstAudio: BaselineMetric;
  interruptionStop: BaselineMetric;
  fluxUsagePercent: number | null;
  falseInterruptionPercent: number | null;
  pass: {
    coldMicReady: boolean | null;
    warmMicReady: boolean | null;
    firstAudioP50: boolean | null;
    firstAudioP95: boolean | null;
    interruptionStop: boolean | null;
    fluxUsage: boolean | null;
    falseInterruptions: boolean | null;
  };
};

declare global {
  interface Window {
    __voiceSessions?: VoiceSessionTiming[];
    __voiceInterruptions?: VoiceInterruptionTiming[];
    __voiceBaselineSnapshot?: () => VoiceBaselineBundle;
    __voiceBaselineJson?: () => string;
  }
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function percentile(values: number[], requested: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(0, Math.min(1, requested / 100)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return rounded(sorted[low]!);
  const weight = rank - low;
  return rounded(sorted[low]! * (1 - weight) + sorted[high]! * weight);
}

function metric(values: number[]): BaselineMetric {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    p50: percentile(finite, 50),
    p95: percentile(finite, 95),
    max: finite.length ? rounded(Math.max(...finite)) : null,
  };
}

function elapsed(
  session: VoiceSessionTiming,
  from: VoiceSessionMark,
  to: VoiceSessionMark,
): number | null {
  const start = session.marks[from];
  const end = session.marks[to];
  return start === undefined || end === undefined ? null : rounded(end - start);
}

function passAtMost(value: number | null, target: number): boolean | null {
  return value === null ? null : value <= target;
}

function passAtLeast(value: number | null, target: number): boolean | null {
  return value === null ? null : value >= target;
}

export function summarizeVoiceBaseline(
  sessions: VoiceSessionTiming[],
  turns: VoiceTimingSummary[],
  interruptions: VoiceInterruptionTiming[],
): VoiceBaselineSummary {
  const coldMicReady = metric(
    sessions
      .filter((session) => !session.warm)
      .map((session) => elapsed(session, 'micRequested', 'micReady'))
      .filter((value): value is number => value !== null),
  );
  const warmMicReady = metric(
    sessions
      .filter((session) => session.warm)
      .map((session) => elapsed(session, 'micRequested', 'micReady'))
      .filter((value): value is number => value !== null),
  );
  const fluxConnect = metric(
    sessions
      .map((session) => elapsed(session, 'fluxRequested', 'fluxConnected'))
      .filter((value): value is number => value !== null),
  );
  const firstAudio = metric(
    turns
      .map((turn) => turn.totalMs)
      .filter((value): value is number => value !== null),
  );
  const interruptionStop = metric(
    interruptions
      .map((interruption) => interruption.stopMs)
      .filter((value): value is number => value !== null),
  );
  const providerTurns = turns.filter(
    (turn) => typeof turn.meta.sttProvider === 'string',
  );
  const fluxTurns = providerTurns.filter(
    (turn) => turn.meta.sttProvider === 'deepgram-flux',
  );
  const fluxUsagePercent = providerTurns.length
    ? rounded((fluxTurns.length / providerTurns.length) * 100)
    : null;
  const judgedInterruptions = interruptions.filter(
    (interruption) => interruption.source !== 'stop-button' && interruption.confirmed !== null,
  );
  const falseInterruptionPercent = judgedInterruptions.length
    ? rounded(
        (judgedInterruptions.filter((interruption) => !interruption.confirmed).length /
          judgedInterruptions.length) *
          100,
      )
    : null;

  return {
    coldMicReady,
    warmMicReady,
    fluxConnect,
    firstAudio,
    interruptionStop,
    fluxUsagePercent,
    falseInterruptionPercent,
    pass: {
      coldMicReady: passAtMost(
        coldMicReady.p95,
        VOICE_ACCEPTANCE_TARGETS.coldMicReadyP95Ms,
      ),
      warmMicReady: passAtMost(
        warmMicReady.p95,
        VOICE_ACCEPTANCE_TARGETS.warmMicReadyP95Ms,
      ),
      firstAudioP50: passAtMost(
        firstAudio.p50,
        VOICE_ACCEPTANCE_TARGETS.firstAudioP50Ms,
      ),
      firstAudioP95: passAtMost(
        firstAudio.p95,
        VOICE_ACCEPTANCE_TARGETS.firstAudioP95Ms,
      ),
      interruptionStop: passAtMost(
        interruptionStop.p95,
        VOICE_ACCEPTANCE_TARGETS.interruptionStopP95Ms,
      ),
      fluxUsage: passAtLeast(
        fluxUsagePercent,
        VOICE_ACCEPTANCE_TARGETS.fluxUsagePercent,
      ),
      falseInterruptions: passAtMost(
        falseInterruptionPercent,
        VOICE_ACCEPTANCE_TARGETS.falseInterruptionPercent,
      ),
    },
  };
}

function publish() {
  if (typeof window === 'undefined') return;
  window.__voiceBaselineSnapshot = () => buildVoiceBaselineBundle(
    window.__voiceSessions ?? [],
    window.__voiceTimings ?? [],
    window.__voiceInterruptions ?? [],
  );
  window.__voiceBaselineJson = () =>
    JSON.stringify(window.__voiceBaselineSnapshot!(), null, 2);
  window.dispatchEvent(new CustomEvent(VOICE_BASELINE_EVENT));
}

export function startVoiceSessionTiming(input: {
  warm: boolean;
  deviceLabel?: string;
  runLabel?: string;
  userAgent?: string;
  viewport?: string;
  network?: string;
  now?: number;
}): VoiceSessionTiming {
  const now = input.now ?? performance.now();
  const session: VoiceSessionTiming = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    warm: input.warm,
    deviceLabel: input.deviceLabel?.trim() || 'unspecified',
    runLabel: input.runLabel?.trim() || 'unlabelled',
    userAgent: input.userAgent ?? '',
    viewport: input.viewport ?? '',
    network: input.network ?? '',
    marks: { mounted: now },
    meta: {},
  };
  if (typeof window !== 'undefined') {
    window.__voiceSessions = [...(window.__voiceSessions ?? []), session];
    publish();
  }
  return session;
}

export function markVoiceSession(
  session: VoiceSessionTiming | null | undefined,
  mark: VoiceSessionMark,
  at: number = performance.now(),
): void {
  if (!session || session.marks[mark] !== undefined) return;
  session.marks[mark] = at;
  publish();
}

export function setVoiceSessionMeta(
  session: VoiceSessionTiming | null | undefined,
  key: string,
  value: string | number | boolean | null,
): void {
  if (!session) return;
  session.meta[key] = value;
  publish();
}

export function startVoiceInterruption(
  source: VoiceInterruptionTiming['source'],
  detectedAt: number = performance.now(),
): VoiceInterruptionTiming {
  const interruption: VoiceInterruptionTiming = {
    id: crypto.randomUUID(),
    source,
    detectedAt,
    confirmed: source === 'stop-button' ? true : null,
    stopMs: null,
  };
  if (typeof window !== 'undefined') {
    window.__voiceInterruptions = [
      ...(window.__voiceInterruptions ?? []),
      interruption,
    ];
    publish();
  }
  return interruption;
}

export function markVoiceInterruptionStopped(
  interruption: VoiceInterruptionTiming | null | undefined,
  stoppedAt: number = performance.now(),
): void {
  if (!interruption || interruption.stoppedAt !== undefined) return;
  interruption.stoppedAt = stoppedAt;
  interruption.stopMs = rounded(Math.max(0, stoppedAt - interruption.detectedAt));
  publish();
}

export function resolveVoiceInterruption(
  interruption: VoiceInterruptionTiming | null | undefined,
  confirmed: boolean,
  at: number = performance.now(),
): void {
  if (!interruption || interruption.confirmed !== null) return;
  interruption.confirmed = confirmed;
  interruption.confirmedAt = at;
  publish();
}

export function buildVoiceBaselineBundle(
  sessions: VoiceSessionTiming[],
  turns: VoiceTimingSummary[],
  interruptions: VoiceInterruptionTiming[],
): VoiceBaselineBundle {
  return {
    exportedAt: new Date().toISOString(),
    targets: VOICE_ACCEPTANCE_TARGETS,
    sessions,
    turns,
    interruptions,
    summary: summarizeVoiceBaseline(sessions, turns, interruptions),
  };
}
