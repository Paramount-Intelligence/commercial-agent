/**
 * Per-phase turn timing. Diagnostic only — no behavior change.
 *
 * Logs cumulative + delta ms per named phase so a slow turn can be attributed
 * to DB round-trips, prompt assembly, the model call, or the validation gate.
 */
export type PhaseTimer = {
  mark: (phase: string) => void;
  /** Total elapsed since construction. */
  total: () => number;
  /** { phase: deltaMs } in mark order. */
  phases: () => Record<string, number>;
  log: (label: string, extra?: Record<string, unknown>) => void;
};

export function startPhaseTimer(scope: string): PhaseTimer {
  const t0 = performance.now();
  let last = t0;
  const deltas: Record<string, number> = {};

  return {
    mark(phase) {
      const now = performance.now();
      deltas[phase] = Math.round(now - last);
      last = now;
    },
    total() {
      return Math.round(performance.now() - t0);
    },
    phases() {
      return { ...deltas };
    },
    log(label, extra) {
      console.info(`[timing:${scope}] ${label}`, {
        totalMs: Math.round(performance.now() - t0),
        phasesMs: { ...deltas },
        ...extra,
      });
    },
  };
}
