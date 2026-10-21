/**
 * Anthropic client and retry policy for agent turns.
 *
 * - Each request times out after MODEL_TIMEOUT_MS.
 * - Transient failures (429, 5xx, network/timeout) are retried at most
 *   MODEL_MAX_RETRIES times with exponential backoff (retry-after honoured,
 *   capped). The SDK's own retries are off, so this is the only retry layer.
 * - A cancelled request (the turn deadline fired) is never retried.
 */
import Anthropic from '@anthropic-ai/sdk';

export const MODEL_TIMEOUT_MS = 20_000;
export const MODEL_MAX_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 8_000;

export const MODEL_CLIENT_OPTIONS = { timeout: MODEL_TIMEOUT_MS, maxRetries: 0 } as const;

export function createAnthropicClient(): Anthropic {
  return new Anthropic(MODEL_CLIENT_OPTIONS);
}

export function statusOf(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

/**
 * Transient: 429 (rate limit), 529 (overloaded) and other 5xx, or a
 * network/timeout error (no HTTP status). 400/401/403/404 are real bugs — fail fast.
 */
export function isTransientModelError(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return false;
  const status = statusOf(err);
  if (status !== undefined) return status === 429 || status >= 500;
  return err instanceof Anthropic.APIConnectionError;
}

/** Honor retry-after (seconds) when the API provides it; else use our backoff. */
function retryAfterMs(err: unknown, fallback: number): number {
  const h = (err as { headers?: unknown })?.headers;
  let raw: string | null | undefined;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    raw = h.get('retry-after');
  } else if (h && typeof h === 'object') {
    const rec = h as Record<string, string | undefined>;
    raw = rec['retry-after'] ?? rec['Retry-After'];
  }
  const sec = raw ? Number(raw) : NaN;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : fallback;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let delay = RETRY_BASE_DELAY_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientModelError(err) || attempt >= MODEL_MAX_RETRIES || opts.signal?.aborted) throw err;
      const wait = Math.min(retryAfterMs(err, delay), RETRY_MAX_DELAY_MS);
      console.warn(
        `[agent-loop] transient model error (status=${statusOf(err) ?? 'network'}), retry ${attempt + 1}/${MODEL_MAX_RETRIES} in ${wait}ms`,
      );
      await sleep(wait);
      if (opts.signal?.aborted) throw err;
      delay = Math.min(delay * 2, RETRY_MAX_DELAY_MS);
    }
  }
}

/**
 * Staging check only: AGENT_TEST_SLOW_MS delays each model call so the turn
 * deadline can be seen end to end. Ignored on builds of main (production);
 * set only on the staging project, and only for the check.
 */
export function testSlowMs(env: Record<string, string | undefined> = process.env): number {
  const ms = Number(env.AGENT_TEST_SLOW_MS);
  if (!Number.isFinite(ms) || ms <= 0 || env.VERCEL_GIT_COMMIT_REF?.trim() === 'main') return 0;
  return Math.min(ms, 120_000);
}

/** Wait testSlowMs() before a model call; a cancelled turn stops waiting (and sends nothing). */
export async function testSlowDelay(signal?: AbortSignal, env: Record<string, string | undefined> = process.env): Promise<void> {
  const ms = testSlowMs(env);
  if (!ms) return;
  if (signal?.aborted) throw new Anthropic.APIUserAbortError();
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Anthropic.APIUserAbortError());
      },
      { once: true },
    );
  });
}
