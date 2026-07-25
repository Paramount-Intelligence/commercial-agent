/**
 * In-process TTL cache for the system-prompt inputs.
 *
 * These four reads (base / guidelines / guardrails layers, shareable-doc
 * catalog, case index) ran on every single turn, costing one DB round-trip
 * each. They only change when an admin publishes a prompt or edits knowledge,
 * so caching them removes that cost from the hot path.
 *
 * Correctness: publish routes call invalidatePromptCache() so the same
 * instance is exact. The TTL is the backstop for other serverless instances,
 * which is why it is short.
 */
const TTL_MS = 30_000;

type Entry<T> = { value: T; expiresAt: number };

const cache = new Map<string, Entry<unknown>>();
/** De-dupes concurrent misses so a cold instance issues one query, not N. */
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise as Promise<T>;
}

/** Call after any write that changes prompt layers, knowledge, or cases. */
export function invalidatePromptCache(): void {
  cache.clear();
}
