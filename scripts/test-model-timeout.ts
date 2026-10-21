/**
 * Unit tests: model request timeout and retries, and the chat/voice turn
 * deadline. No network, no model calls.
 *
 *   npx tsx scripts/test-model-timeout.ts
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  createAnthropicClient,
  isTransientModelError,
  MODEL_CLIENT_OPTIONS,
  MODEL_MAX_RETRIES,
  MODEL_TIMEOUT_MS,
  testSlowDelay,
  testSlowMs,
  withRetry,
} from '../lib/agent/modelClient';
import { runWithTurnDeadline, TURN_DEADLINE_MS, TURN_TIMEOUT_REPLY } from '../lib/agent/turnDeadline';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

let unhandled = 0;
process.on('unhandledRejection', () => void unhandled++);
console.warn = () => {}; // retry notices

/** fn that fails with the given errors in order, then returns 'ok'. */
function failing(errors: unknown[]) {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls <= errors.length) throw errors[calls - 1];
    return 'ok';
  };
  return { fn, calls: () => calls };
}

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

async function main() {
  // Client settings.
  ok('request timeout is 20 s', MODEL_TIMEOUT_MS === 20_000 && MODEL_CLIENT_OPTIONS.timeout === 20_000);
  ok('SDK retries are off (one retry layer)', MODEL_CLIENT_OPTIONS.maxRetries === 0);
  const client = createAnthropicClient();
  ok('client is built with those settings', client.timeout === 20_000 && client.maxRetries === 0);
  ok('at most 2 retries', MODEL_MAX_RETRIES === 2);

  // What counts as transient.
  ok('529 is transient', isTransientModelError({ status: 529 }));
  ok('429 is transient', isTransientModelError({ status: 429 }));
  ok('request timeout is transient', isTransientModelError(new Anthropic.APIConnectionTimeoutError()));
  ok('400 is not transient', !isTransientModelError({ status: 400 }));
  ok('a cancelled request is not transient', !isTransientModelError(new Anthropic.APIUserAbortError()));

  // Retries with backoff.
  {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const f = failing([{ status: 529 }, { status: 529 }, { status: 529 }, { status: 529 }]);
    const err = await rejects(withRetry(f.fn, { sleep }));
    ok('persistent 529: 3 attempts in total, then the error', f.calls() === 3 && (err as { status?: number })?.status === 529);
    ok('backoff doubles (1 s, 2 s)', waits.length === 2 && waits[0] === 1000 && waits[1] === 2000);

    const f2 = failing([new Anthropic.APIConnectionTimeoutError()]);
    ok('a timed-out request is retried and can succeed', (await withRetry(f2.fn, { sleep })) === 'ok' && f2.calls() === 2);

    const f3 = failing([{ status: 400 }]);
    await rejects(withRetry(f3.fn, { sleep }));
    ok('400 fails fast (no retry)', f3.calls() === 1);

    const f4 = failing([new Anthropic.APIUserAbortError()]);
    await rejects(withRetry(f4.fn, { sleep }));
    ok('a cancelled request is not retried', f4.calls() === 1);

    const ac = new AbortController();
    ac.abort();
    const f5 = failing([{ status: 529 }]);
    await rejects(withRetry(f5.fn, { sleep, signal: ac.signal }));
    ok('no retry once the turn deadline has passed', f5.calls() === 1);

    const waits2: number[] = [];
    const f6 = failing([{ status: 429, headers: { 'retry-after': '3' } }, { status: 429, headers: { 'retry-after': '60' } }]);
    await withRetry(f6.fn, { sleep: async (ms) => void waits2.push(ms) });
    ok('retry-after honoured, capped at 8 s', waits2[0] === 3000 && waits2[1] === 8000);
  }

  // Staging-only slow switch.
  ok('slow switch off by default', testSlowMs({}) === 0);
  ok('slow switch on when set', testSlowMs({ AGENT_TEST_SLOW_MS: '50000', VERCEL_GIT_COMMIT_REF: 'develop' }) === 50_000);
  ok('slow switch ignored on main builds', testSlowMs({ AGENT_TEST_SLOW_MS: '50000', VERCEL_GIT_COMMIT_REF: 'main' }) === 0);
  {
    const env = { AGENT_TEST_SLOW_MS: '60000' };
    const out = await runWithTurnDeadline(async (signal) => {
      await testSlowDelay(signal, env);
      return 'sent';
    }, { deadlineMs: 30 });
    ok('a slowed turn hits the deadline and never sends the call', out.timedOut);
  }

  // Turn deadline.
  ok('turn deadline is 45 s', TURN_DEADLINE_MS === 45_000);
  ok('friendly message', TURN_TIMEOUT_REPLY === 'This is taking longer than usual. Please try again in a moment.');
  {
    const fast = await runWithTurnDeadline(async () => 'reply', { deadlineMs: 200 });
    ok('a turn within the deadline returns its result', !fast.timedOut && fast.value === 'reply');

    let seenSignal: AbortSignal | null = null;
    let timeouts = 0;
    const slow = await runWithTurnDeadline(
      (signal) => {
        seenSignal = signal;
        return new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()));
        });
      },
      { deadlineMs: 30, onTimeout: () => void timeouts++ },
    );
    ok('a slow turn times out', slow.timedOut && slow.elapsedMs >= 25);
    ok('the in-flight call is cancelled', (seenSignal as AbortSignal | null)?.aborted === true);
    ok('timeout reported once (log + alert)', timeouts === 1);

    const err = await rejects(runWithTurnDeadline(async () => Promise.reject(new Error('boom')), { deadlineMs: 200 }));
    ok('an error before the deadline is passed on unchanged', (err as Error)?.message === 'boom');

    let lateTimeouts = 0;
    const late = await runWithTurnDeadline(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 60)),
      { deadlineMs: 20, onTimeout: () => void lateTimeouts++ },
    );
    await new Promise((r) => setTimeout(r, 80));
    ok('a late result is ignored', late.timedOut && lateTimeouts === 1);
    ok('no unhandled rejections', unhandled === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
