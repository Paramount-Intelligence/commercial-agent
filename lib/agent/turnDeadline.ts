/**
 * Turn deadline for chat and voice: if a turn has not finished after
 * TURN_DEADLINE_MS, the user gets a friendly reply, the in-flight model call
 * is cancelled (AbortSignal), and the timeout is logged and alerted.
 */
export const TURN_DEADLINE_MS = 45_000;
export const TURN_TIMEOUT_REPLY = 'This is taking longer than usual. Please try again in a moment.';

export type DeadlineOutcome<T> = { timedOut: false; value: T } | { timedOut: true; elapsedMs: number };

/**
 * Run a turn against a deadline. `run` receives a signal that aborts when the
 * deadline passes; a late result or error after that is ignored. Errors before
 * the deadline are rethrown unchanged.
 */
export async function runWithTurnDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  opts: { deadlineMs?: number; onTimeout?: (elapsedMs: number) => void } = {},
): Promise<DeadlineOutcome<T>> {
  const deadlineMs = opts.deadlineMs ?? TURN_DEADLINE_MS;
  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const turn = run(controller.signal);
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deadlineMs);
  });
  try {
    const first = await Promise.race([turn.then((value) => ({ value })), deadline]);
    if (first !== 'timeout') return { timedOut: false, value: first.value };
    const elapsedMs = Date.now() - startedAt;
    controller.abort();
    turn.catch(() => {}); // the cancelled turn's late error is expected
    opts.onTimeout?.(elapsedMs);
    return { timedOut: true, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}
