export class RetrievalDeadlineError extends Error {
  constructor(public readonly deadlineMs: number) {
    super(`Knowledge retrieval exceeded ${deadlineMs}ms`);
    this.name = 'RetrievalDeadlineError';
  }
}

/**
 * Bound the caller's wait even when an underlying database/client operation
 * cannot consume an AbortSignal. The losing promise remains observed, so a
 * late rejection cannot become an unhandled rejection.
 */
export async function waitForRetrieval<T>(
  work: Promise<T>,
  opts: {
    deadlineMs: number;
    signal?: AbortSignal;
    onDeadline?: () => void;
  },
): Promise<T> {
  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      opts.onDeadline?.();
      reject(new RetrievalDeadlineError(opts.deadlineMs));
    }, opts.deadlineMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!opts.signal) return;
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    opts.signal.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => opts.signal?.removeEventListener('abort', abort);
  });

  try {
    return await Promise.race([work, deadline, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener?.();
  }
}
