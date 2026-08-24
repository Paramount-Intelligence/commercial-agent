/**
 * Process-local Fish TTS concurrency gate.
 *
 * Fish Starter tier allows only ~5 concurrent requests. Voice boot used to
 * fire intro + fillers + acks in parallel and immediately 429. Serialize
 * synthesis in this Node process so we stay under the limit (multi-instance
 * still shares the Fish quota — keep client prep sequential too).
 */
type QueueJob<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

const queue: QueueJob<unknown>[] = [];
let active = 0;
/** Stay at 1 — safest against Starter (5) when multiple lambdas overlap. */
const MAX_CONCURRENT = 1;

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    active += 1;
    void job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

export function withFishTtsSlot<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    pump();
  });
}
